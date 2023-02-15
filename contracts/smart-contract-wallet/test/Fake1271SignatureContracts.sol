// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

contract FakeSigner {
    bytes4 internal constant EIP1271_MAGIC_VALUE = 0x20c13b0b;

    function getSignature() public view returns(bytes memory signature) {
        bytes32 fakeSignerPadded = bytes32(uint256(uint160(address(this))));
        // Add fake signature (r,s,v) to pass all requirments.
        // v=0 to indicate eip-1271 signer "fakeSignerPadded" which will always return true
        signature = abi.encodePacked(fakeSignerPadded, bytes32(uint256(65)),uint8(0), bytes32(0x0));
    }

    // Always return valid EIP1271_MAGIC_VALUE
    function isValidSignature(bytes memory data, bytes memory contractSignature) external pure returns (bytes4) {
        return EIP1271_MAGIC_VALUE;
    }
}

contract SelfDestructingContract {
    // All this does is self destruct and send funds to "to"
    function selfDestruct(address to) external {
        selfdestruct(payable(to));
    }
}