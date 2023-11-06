// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {IEcdsaOwnershipRegistryModule} from "../interfaces/modules/IEcdsaOwnershipRegistryModule.sol";
import {IAddressResolver} from "../interfaces/IAddressResolver.sol";
import {ISmartAccount} from "../interfaces/ISmartAccount.sol";

/// EOA <-> Smart Account address resolver for Biconomy smart accounts
contract AddressResolver {
    struct SmartAccountResult {
        address accountAddress;
        address factoryAddress;
        address currentImplementation;
        string currentVersion;
        string factoryVersion;
        uint256 deploymentIndex;
    }

    address public constant SA_V1_FACTORY =
        0x000000F9eE1842Bb72F6BBDD75E6D3d4e3e9594C;
    address public constant SA_V2_FACTORY =
        0x000000a56Aaca3e9a4C479ea6b6CD0DbcB6634F5;
    address public constant ECDSA_REGISTRY_MODULE_ADDRESS =
        0x0000001c5b32F37F5beA87BDD5374eB2aC54eA8e;

    // Note: Could also add a method to just get V1 accounts upgraded to V2

    /**
     * @dev Returns the addresses of all the smart accounts deployed by the EOA for any deployment index from 0 to _maxIndex.
     * @param _eoa Address of the EOA.
     * @param _maxIndex Maximum index to check.
     * @notice This function is only for V1 and V2 Biconomy smart accounts.
     * @notice For V2 smart accounts, the _moduleAddress and _moduleSetupData parameters are not used. It assumes ECDSA module.
     */
    function resolveAddresses(
        address _eoa,
        uint8 _maxIndex
    ) external view returns (SmartAccountResult[] memory) {
        SmartAccountResult[] memory _saInfo = new SmartAccountResult[](
            _maxIndex * 2
        );
        uint256 saInfoIndex = 0; // To keep track of the current index in _saAddresses

        for (uint256 i; i < _maxIndex; i++) {
            address v1Address = IAddressResolver(SA_V1_FACTORY)
                .getAddressForCounterFactualAccount(_eoa, i);
            if (v1Address != address(0) && _isSmartContract(v1Address)) {
                _saInfo[saInfoIndex] = SmartAccountResult(
                    v1Address,
                    SA_V1_FACTORY,
                    ISmartAccount(v1Address).getImplementation(),
                    ISmartAccount(v1Address).VERSION(),
                    "v1",
                    i
                );
                saInfoIndex++;
            }

            bytes4 selector = IEcdsaOwnershipRegistryModule(
                ECDSA_REGISTRY_MODULE_ADDRESS
            ).initForSmartAccount.selector;
            bytes memory data = abi.encodeWithSelector(selector, _eoa);

            address v2Address = IAddressResolver(SA_V2_FACTORY)
                .getAddressForCounterFactualAccount(
                    ECDSA_REGISTRY_MODULE_ADDRESS,
                    data,
                    i
                );
            if (v2Address != address(0) && _isSmartContract(v2Address)) {
                _saInfo[saInfoIndex] = SmartAccountResult(
                    v2Address,
                    SA_V2_FACTORY,
                    ISmartAccount(v2Address).getImplementation(),
                    ISmartAccount(v2Address).VERSION(),
                    "v2",
                    i
                );
                saInfoIndex++;
            }
        }

        // Create a new dynamic array with only the used elements
        SmartAccountResult[] memory result = new SmartAccountResult[](
            saInfoIndex
        );
        for (uint256 j = 0; j < saInfoIndex; j++) {
            result[j] = _saInfo[j];
        }
        return result;
    }

    /**
     * @dev Returns the addresses of all the smart accounts deployed by the EOA for any deployment index from 0 to _maxIndex.
     * @param _eoa Address of the EOA.
     * @param _maxIndex Maximum index to check.
     * @param _moduleAddress Address of the auth module used to deploy the smart accounts.
     * @param _moduleSetupData module setup data used to deploy the smart accounts.
     * @notice This function is only for V1 and V2 Biconomy smart accounts.
     * @notice For V2 smart accounts, the _moduleAddress and _moduleSetupData parameters are used. It can be any auth module (which uses ecda owner) used with the factory
     */
    function resolveAddressesFlexibleForV2(
        address _eoa,
        uint8 _maxIndex,
        address _moduleAddress, // V2 factory could use any auth module
        bytes memory _moduleSetupData
    ) external view returns (SmartAccountResult[] memory) {
        SmartAccountResult[] memory _saInfo = new SmartAccountResult[](
            _maxIndex * 2
        );
        uint256 saInfoIndex = 0; // To keep track of the current index in _saAddresses

        for (uint256 i; i < _maxIndex; i++) {
            address v1Address = IAddressResolver(SA_V1_FACTORY)
                .getAddressForCounterFactualAccount(_eoa, i);
            if (v1Address != address(0) && _isSmartContract(v1Address)) {
                _saInfo[saInfoIndex] = SmartAccountResult(
                    v1Address,
                    SA_V1_FACTORY,
                    ISmartAccount(v1Address).getImplementation(),
                    ISmartAccount(v1Address).VERSION(),
                    "v1",
                    i
                );
                saInfoIndex++;
            }

            address v2Address = IAddressResolver(SA_V2_FACTORY)
                .getAddressForCounterFactualAccount(
                    _moduleAddress,
                    _moduleSetupData,
                    i
                );
            if (v2Address != address(0) && _isSmartContract(v2Address)) {
                _saInfo[saInfoIndex] = SmartAccountResult(
                    v2Address,
                    SA_V2_FACTORY,
                    ISmartAccount(v2Address).getImplementation(),
                    ISmartAccount(v2Address).VERSION(),
                    "v2",
                    i
                );
                saInfoIndex++;
            }
        }

        // Create a new dynamic array with only the used elements
        SmartAccountResult[] memory result = new SmartAccountResult[](
            saInfoIndex
        );
        for (uint256 j = 0; j < saInfoIndex; j++) {
            result[j] = _saInfo[j];
        }
        return result;
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
