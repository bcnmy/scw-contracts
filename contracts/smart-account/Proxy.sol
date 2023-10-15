// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/**
 * @title Proxy // This is the user's Smart Account
 * @notice Basic proxy that delegates all calls to a fixed implementation contract.
 * @dev    Implementation address is stored in the slot defined by the Proxy's address
 */
contract Proxy {
    error NotSmartContract(address account);
    constructor(address _implementation) {
        if (!_isSmartContract(_implementation)) 
            revert NotSmartContract(_implementation);
        
        assembly {
            sstore(address(), _implementation)
        }
    }

    fallback() external payable {
        address target;
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

    /**
     * @dev Checks if the address provided is a smart contract.
     * @param account Address to be checked.
     */
     function _isSmartContract(address account) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }
}
