// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

/**
 * @title Proxy // This is the user's wallet
 * @notice Basic proxy that delegates all calls to a fixed implementing contract.
 */
 interface IProxy {
    function accountLogic() external view returns (address);
}

contract Proxy {
    // no fixed address(0) storage slot
    // address internal singleton;

    // uint256[1] private ______gap;

    constructor(address _implementation) {
         require(_implementation != address(0), "Invalid implementation address");
         // solhint-disable-next-line no-inline-assembly
         assembly {
             sstore(address(),_implementation) 
         }
    }

    fallback() external payable {
        address target;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            target := sload(address())
            // 0xee9118f7 == keccak("accountLogic()"). The value is right padded to 32-bytes with 0s
            if eq(calldataload(0), 0xee9118f700000000000000000000000000000000000000000000000000000000) {
                mstore(0, target)
                return(0, 0x20)
            }
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {revert(0, returndatasize())}
            default {return (0, returndatasize())}
        }
    }

}