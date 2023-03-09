// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/**
 * @title Proxy // This is the user's wallet
 * @notice Basic proxy that delegates all calls to a fixed implementing contract.
 */
contract Proxy {
    // no fixed address(0) storage slot
    // address internal singleton;

    constructor(address _implementation) {
        require(
            _implementation != address(0),
            "Invalid implementation address"
        );
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(address(), _implementation)
        }
    }

    fallback() external payable {
        address target;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            target := sload(address())
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
