// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ERC-4907: Rental NFT, an extension of ERC-721
/// @notice Separates who OWNS a token from who may currently USE it, with an automatic expiry.
/// @dev https://eips.ethereum.org/EIPS/eip-4907 (interface id 0xad092b5c)
interface IERC4907 {
    /// @notice Emitted when the user of an NFT or its expiry changes. A zero user means "no user".
    event UpdateUser(uint256 indexed tokenId, address indexed user, uint64 expires);

    /// @notice Sets the user and expiry of an NFT. Only the owner or an approved operator may call it.
    function setUser(uint256 tokenId, address user, uint64 expires) external;

    /// @notice The current user of an NFT, or the zero address if there is none or it has expired.
    function userOf(uint256 tokenId) external view returns (address);

    /// @notice The UNIX timestamp when the current user's access ends.
    function userExpires(uint256 tokenId) external view returns (uint256);
}
