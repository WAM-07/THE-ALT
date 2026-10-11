// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ALTMarketplace} from "../ALTMarketplace.sol";

/// @dev TEST ONLY. A buyer that, on receiving a token, tries to buy another one in the same call
///      (re-entrancy). The marketplace must refuse.
contract ReentrantBuyer is IERC721Receiver {
    ALTMarketplace public immutable market;
    uint256 public secondTokenId;
    uint256 public secondPrice;

    constructor(ALTMarketplace market_) {
        market = market_;
    }

    function attack(uint256 firstTokenId, uint256 secondTokenId_, uint256 secondPrice_) external payable {
        secondTokenId = secondTokenId_;
        secondPrice = secondPrice_;
        market.buy{value: msg.value - secondPrice_}(firstTokenId);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (secondTokenId != 0) {
            uint256 id = secondTokenId;
            secondTokenId = 0;
            market.buy{value: secondPrice}(id);
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @dev TEST ONLY. A seller that cannot receive POL. With pull payments it only hurts itself.
contract RejectingReceiver {
    function approveAndList(address registry, address market, uint256 tokenId, uint256 price) external {
        (bool ok,) = registry.call(abi.encodeWithSignature("setApprovalForAll(address,bool)", market, true));
        require(ok, "approve failed");
        ALTMarketplace(market).listForSale(tokenId, price);
    }

    function withdrawFrom(address market) external {
        ALTMarketplace(market).withdraw();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        revert("no thanks");
    }
}
