// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AITRegistry} from "./AITRegistry.sol";

/// @title ALTAR marketplace for AI Identity Tokens
/// @notice Owners can SELL an AI (ownership moves to the buyer) or RENT it out (the renter becomes
///         its ERC-4907 user until the rental ends; ownership does not move).
///         Every payment is split three ways and credited to balances that people withdraw:
///           - platform fee   -> treasury
///           - creator royalty (ERC-2981 of the AIT) -> the AI's creator, unless the creator is the one being paid
///           - the rest       -> the seller / owner
/// @dev Pull payments: nothing is pushed during a purchase, so a failing recipient cannot block a
///      sale and no funds get stuck. Exact payment is required; overpayment is rejected.
contract ALTMarketplace is Ownable, ReentrancyGuard {
    struct Sale {
        address seller;
        uint256 price;
    }

    struct RentalOffer {
        address owner;
        uint256 pricePerDay;
        uint32 maxDays;
    }

    uint96 public constant MAX_FEE_BPS = 1_000;
    uint32 public constant MAX_RENTAL_DAYS = 365;

    AITRegistry public immutable registry;
    address public treasury;
    uint96 public platformFeeBps;

    mapping(uint256 tokenId => Sale) public sales;
    mapping(uint256 tokenId => RentalOffer) public rentalOffers;

    /// @notice Withdrawable earnings per account (sellers, owners, creators, treasury).
    mapping(address account => uint256 amount) public balances;

    event ListedForSale(uint256 indexed tokenId, address indexed seller, uint256 price);
    event SaleCancelled(uint256 indexed tokenId);
    event Sold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        address royaltyReceiver,
        uint256 royalty,
        uint256 fee
    );
    event ListedForRent(uint256 indexed tokenId, address indexed owner, uint256 pricePerDay, uint32 maxDays);
    event RentalOfferCancelled(uint256 indexed tokenId);
    event Rented(
        uint256 indexed tokenId,
        address indexed owner,
        address indexed renter,
        uint32 numDays,
        uint64 expires,
        uint256 paid,
        uint256 royalty,
        uint256 fee
    );
    event Withdrawn(address indexed account, uint256 amount);
    event PlatformFeeUpdated(uint96 feeBps);
    event TreasuryUpdated(address treasury);

    error ZeroAddress();
    error FeeTooHigh(uint96 feeBps);
    error NotTokenOwner(address caller);
    error MarketplaceNotApproved(uint256 tokenId);
    error InvalidPrice();
    error InvalidDuration(uint32 numDays);
    error NotListed(uint256 tokenId);
    error StaleListing(uint256 tokenId);
    error WrongPayment(uint256 expected, uint256 sent);
    error TokenSuspended(uint256 tokenId);
    error TokenRented(uint256 tokenId);
    error CannotBuyOwnToken();
    error NothingToWithdraw();
    error WithdrawFailed();

    constructor(AITRegistry registry_, address treasury_, uint96 platformFeeBps_, address admin) Ownable(admin) {
        if (address(registry_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (platformFeeBps_ > MAX_FEE_BPS) revert FeeTooHigh(platformFeeBps_);
        registry = registry_;
        treasury = treasury_;
        platformFeeBps = platformFeeBps_;
    }

    // ------------------------------------------------------------------ selling

    function listForSale(uint256 tokenId, uint256 price) external {
        _requireOwnerReady(tokenId);
        if (price == 0) revert InvalidPrice();
        sales[tokenId] = Sale({seller: msg.sender, price: price});
        emit ListedForSale(tokenId, msg.sender, price);
    }

    /// @notice The seller can always cancel; anyone can clear a listing whose seller no longer owns the token.
    function cancelSale(uint256 tokenId) external {
        Sale memory sale = sales[tokenId];
        if (sale.price == 0) revert NotListed(tokenId);
        if (msg.sender != sale.seller && registry.ownerOf(tokenId) == sale.seller) revert NotTokenOwner(msg.sender);
        delete sales[tokenId];
        emit SaleCancelled(tokenId);
    }

    function buy(uint256 tokenId) external payable nonReentrant {
        Sale memory sale = sales[tokenId];
        if (sale.price == 0) revert NotListed(tokenId);
        if (msg.value != sale.price) revert WrongPayment(sale.price, msg.value);
        if (registry.ownerOf(tokenId) != sale.seller) revert StaleListing(tokenId);
        if (msg.sender == sale.seller) revert CannotBuyOwnToken();
        if (registry.isSuspended(tokenId)) revert TokenSuspended(tokenId);
        if (registry.userOf(tokenId) != address(0)) revert TokenRented(tokenId);

        // Effects before the transfer (which can call back into a contract buyer).
        delete sales[tokenId];
        delete rentalOffers[tokenId]; // the new owner sets their own rental terms
        (address royaltyReceiver, uint256 royalty, uint256 fee) = _split(tokenId, sale.seller, sale.price);

        registry.safeTransferFrom(sale.seller, msg.sender, tokenId);
        emit Sold(tokenId, sale.seller, msg.sender, sale.price, royaltyReceiver, royalty, fee);
    }

    // ------------------------------------------------------------------ renting

    function listForRent(uint256 tokenId, uint256 pricePerDay, uint32 maxDays) external {
        _requireOwnerReady(tokenId);
        if (pricePerDay == 0) revert InvalidPrice();
        if (maxDays == 0 || maxDays > MAX_RENTAL_DAYS) revert InvalidDuration(maxDays);
        rentalOffers[tokenId] = RentalOffer({owner: msg.sender, pricePerDay: pricePerDay, maxDays: maxDays});
        emit ListedForRent(tokenId, msg.sender, pricePerDay, maxDays);
    }

    function cancelRentalOffer(uint256 tokenId) external {
        RentalOffer memory offer = rentalOffers[tokenId];
        if (offer.pricePerDay == 0) revert NotListed(tokenId);
        if (msg.sender != offer.owner && registry.ownerOf(tokenId) == offer.owner) revert NotTokenOwner(msg.sender);
        delete rentalOffers[tokenId];
        emit RentalOfferCancelled(tokenId);
    }

    /// @notice Rents the AI for `numDays`. Access ends automatically when the rental expires.
    function rent(uint256 tokenId, uint32 numDays) external payable nonReentrant {
        RentalOffer memory offer = rentalOffers[tokenId];
        if (offer.pricePerDay == 0) revert NotListed(tokenId);
        if (numDays == 0 || numDays > offer.maxDays) revert InvalidDuration(numDays);
        if (registry.ownerOf(tokenId) != offer.owner) revert StaleListing(tokenId);
        if (msg.sender == offer.owner) revert CannotBuyOwnToken();
        if (registry.isSuspended(tokenId)) revert TokenSuspended(tokenId);
        if (registry.userOf(tokenId) != address(0)) revert TokenRented(tokenId);

        uint256 total = offer.pricePerDay * numDays;
        if (msg.value != total) revert WrongPayment(total, msg.value);

        uint64 expires = uint64(block.timestamp + uint256(numDays) * 1 days);
        (, uint256 royalty, uint256 fee) = _split(tokenId, offer.owner, total);
        registry.setUser(tokenId, msg.sender, expires);
        emit Rented(tokenId, offer.owner, msg.sender, numDays, expires, total, royalty, fee);
    }

    // ------------------------------------------------------------------ payouts

    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        balances[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------ admin

    function setPlatformFee(uint96 feeBps) external onlyOwner {
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh(feeBps);
        platformFeeBps = feeBps;
        emit PlatformFeeUpdated(feeBps);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    // ------------------------------------------------------------------ internals

    function _requireOwnerReady(uint256 tokenId) private view {
        address owner = registry.ownerOf(tokenId);
        if (msg.sender != owner) revert NotTokenOwner(msg.sender);
        if (!registry.isApprovedForAll(owner, address(this)) && registry.getApproved(tokenId) != address(this)) {
            revert MarketplaceNotApproved(tokenId);
        }
        if (registry.isSuspended(tokenId)) revert TokenSuspended(tokenId);
    }

    /// @dev Credits fee, creator royalty and the payee's share. No royalty when the creator is the payee
    ///      (a creator's own first sale or rental).
    function _split(uint256 tokenId, address payee, uint256 amount)
        private
        returns (address royaltyReceiver, uint256 royalty, uint256 fee)
    {
        fee = (amount * platformFeeBps) / 10_000;
        (royaltyReceiver, royalty) = registry.royaltyInfo(tokenId, amount);
        if (royaltyReceiver == payee) royalty = 0;
        balances[treasury] += fee;
        if (royalty > 0) balances[royaltyReceiver] += royalty;
        balances[payee] += amount - fee - royalty;
    }
}
