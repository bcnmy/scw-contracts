// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockNFT is ERC721 {
    uint256 nextTokenId = 0;

    constructor() ERC721("TST", "MockToken") {}

    function mintNext(address sender) external {
        _mint(sender, nextTokenId);
        nextTokenId++;
    }
}
