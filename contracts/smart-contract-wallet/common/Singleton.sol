// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.12;

/// @title Singleton - Base for singleton contracts (should always be first super contract)
///         This contract is tightly coupled to the proxy contract
contract Singleton {
    // singleton slot always needs to be first declared variable, to ensure that it is at the same location as in the Proxy contract.

    /* This is the keccak-256 hash of "biconomy.scw.proxy.implementation" subtracted by 1 */
    bytes32 internal constant _IMPLEMENTATION_SLOT = 0x37722d148fb373b961a84120b6c8d209709b45377878a466db32bbc40d95af26;

    function _setImplementation(address _imp) internal {
        assert(_IMPLEMENTATION_SLOT == bytes32(uint256(keccak256("biconomy.scw.proxy.implementation")) - 1));
        // solhint-disable-next-line no-inline-assembly
        assembly {
          sstore(_IMPLEMENTATION_SLOT, _imp)
         }
    }

    function _getImplementation() internal view returns (address _imp) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
         _imp := sload(_IMPLEMENTATION_SLOT)
        }
    }

}
