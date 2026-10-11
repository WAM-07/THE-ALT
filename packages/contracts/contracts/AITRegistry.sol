// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC4907} from "./interfaces/IERC4907.sol";

/// @title AI Identity Token (AIT) registry for THE ALT ECOSYSTEM
/// @notice Each personal AI gets one ERC-721 token. The token proves:
///   - who CREATED the AI (fixed forever),
///   - who OWNS it now (`ownerOf`, changes when it is sold),
///   - who may currently USE it (`userOf`, ERC-4907, set by rentals and expiring automatically),
///   - its version history (each version's manifest is pinned to IPFS; `tokenURI` points at the latest),
///   - the creator's royalty on later sales and rentals (ERC-2981).
/// @dev Minting is done by ALT Core's relayer (MINTER_ROLE) after the AI passes its clearance checks,
///      so people do not need crypto to get a verified AI. GOVERNOR_ROLE can suspend abusive AIs.
contract AITRegistry is ERC721, ERC2981, AccessControl, IERC4907 {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    /// @notice Royalties are capped at 10% so resale and rental stay viable.
    uint96 public constant MAX_ROYALTY_BPS = 1_000;

    struct Identity {
        bytes32 aiId; // ALT Core's id for the AI (its UUID, as bytes32)
        address creator; // set at mint, never changes
        uint64 version; // 1 at mint, +1 for every published version
        bool suspended;
        string manifestCid; // IPFS CID of the latest version's manifest
    }

    struct Rental {
        address user;
        uint64 expires;
    }

    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => Identity) private _identities;
    mapping(uint256 tokenId => Rental) private _rentals;

    /// @notice Token for an ALT AI id (0 if not minted). One token per AI, ever.
    mapping(bytes32 aiId => uint256 tokenId) public tokenOfAi;

    /// @notice Manifests already recorded. A manifest can identify only one AI version.
    mapping(bytes32 manifestHash => bool used) public manifestUsed;

    event AIMinted(uint256 indexed tokenId, bytes32 indexed aiId, address indexed creator, string manifestCid, uint96 royaltyBps);
    event VersionPublished(uint256 indexed tokenId, uint64 version, string manifestCid);
    event Suspended(uint256 indexed tokenId, string reason);
    event Unsuspended(uint256 indexed tokenId);

    error InvalidAiId();
    error EmptyManifest();
    error AIAlreadyMinted(bytes32 aiId);
    error ManifestAlreadyUsed(string manifestCid);
    error RoyaltyTooHigh(uint96 royaltyBps);
    error NotOwnerOrMinter(address caller);
    error NotAuthorized(address caller);
    error TokenIsSuspended(uint256 tokenId);
    error TokenIsRented(uint256 tokenId, address user, uint64 expires);

    constructor(address admin) ERC721("ALT AI Identity Token", "AIT") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
    }

    // ------------------------------------------------------------------ identity

    /// @notice Mints the identity token of a newly cleared AI to its creator.
    function mint(address creator, bytes32 aiId, string calldata manifestCid, uint96 royaltyBps)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        if (aiId == bytes32(0)) revert InvalidAiId();
        if (tokenOfAi[aiId] != 0) revert AIAlreadyMinted(aiId);
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(royaltyBps);
        _useManifest(manifestCid);

        tokenId = _nextTokenId++;
        tokenOfAi[aiId] = tokenId;
        _identities[tokenId] = Identity({aiId: aiId, creator: creator, version: 1, suspended: false, manifestCid: manifestCid});
        _setTokenRoyalty(tokenId, creator, royaltyBps);
        _safeMint(creator, tokenId);

        emit AIMinted(tokenId, aiId, creator, manifestCid, royaltyBps);
        emit VersionPublished(tokenId, 1, manifestCid);
    }

    /// @notice Records a new version of the AI (its owner retrained or updated it in ALTER).
    /// @dev The relayer may publish for owners whose wallet ALT manages for them.
    function publishVersion(uint256 tokenId, string calldata manifestCid) external returns (uint64 version) {
        address owner = _requireOwned(tokenId);
        if (msg.sender != owner && !hasRole(MINTER_ROLE, msg.sender)) revert NotOwnerOrMinter(msg.sender);
        Identity storage identity = _identities[tokenId];
        if (identity.suspended) revert TokenIsSuspended(tokenId);
        _useManifest(manifestCid);

        version = ++identity.version;
        identity.manifestCid = manifestCid;
        emit VersionPublished(tokenId, version, manifestCid);
    }

    function identityOf(uint256 tokenId) external view returns (Identity memory) {
        _requireOwned(tokenId);
        return _identities[tokenId];
    }

    function creatorOf(uint256 tokenId) external view returns (address) {
        _requireOwned(tokenId);
        return _identities[tokenId].creator;
    }

    function isSuspended(uint256 tokenId) public view returns (bool) {
        return _identities[tokenId].suspended;
    }

    /// @notice `ipfs://<cid>` of the latest version's manifest.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat("ipfs://", _identities[tokenId].manifestCid);
    }

    // ------------------------------------------------------------------ governance

    /// @notice Stops an AI from being transferred, rented or updated (policy violation, dispute, ...).
    function suspend(uint256 tokenId, string calldata reason) external onlyRole(GOVERNOR_ROLE) {
        _requireOwned(tokenId);
        _identities[tokenId].suspended = true;
        emit Suspended(tokenId, reason);
    }

    function unsuspend(uint256 tokenId) external onlyRole(GOVERNOR_ROLE) {
        _requireOwned(tokenId);
        _identities[tokenId].suspended = false;
        emit Unsuspended(tokenId);
    }

    // ------------------------------------------------------------------ rentals (ERC-4907)

    /// @notice Grants `user` the right to use the AI until `expires`. Called by the marketplace when
    ///         someone rents the AI. An active rental cannot be replaced or cut short.
    function setUser(uint256 tokenId, address user, uint64 expires) external {
        address owner = _requireOwned(tokenId);
        if (!_isAuthorized(owner, msg.sender, tokenId)) revert NotAuthorized(msg.sender);
        if (_identities[tokenId].suspended) revert TokenIsSuspended(tokenId);
        Rental memory current = _rentals[tokenId];
        if (current.user != address(0) && current.expires >= block.timestamp) {
            revert TokenIsRented(tokenId, current.user, current.expires);
        }
        _rentals[tokenId] = Rental({user: user, expires: expires});
        emit UpdateUser(tokenId, user, expires);
    }

    function userOf(uint256 tokenId) public view returns (address) {
        Rental memory r = _rentals[tokenId];
        return r.expires >= block.timestamp ? r.user : address(0);
    }

    function userExpires(uint256 tokenId) public view returns (uint256) {
        return _rentals[tokenId].expires;
    }

    // ------------------------------------------------------------------ internals

    function _useManifest(string calldata manifestCid) private {
        if (bytes(manifestCid).length == 0) revert EmptyManifest();
        bytes32 h = keccak256(bytes(manifestCid));
        if (manifestUsed[h]) revert ManifestAlreadyUsed(manifestCid);
        manifestUsed[h] = true;
    }

    /// @dev Transfers (not mints) are blocked while the AI is suspended or rented; a finished rental
    ///      is cleared so the new owner starts clean.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            if (_identities[tokenId].suspended) revert TokenIsSuspended(tokenId);
            Rental memory r = _rentals[tokenId];
            if (r.user != address(0)) {
                if (r.expires >= block.timestamp) revert TokenIsRented(tokenId, r.user, r.expires);
                delete _rentals[tokenId];
                emit UpdateUser(tokenId, address(0), 0);
            }
        }
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981, AccessControl) returns (bool) {
        return interfaceId == type(IERC4907).interfaceId || super.supportsInterface(interfaceId);
    }
}
