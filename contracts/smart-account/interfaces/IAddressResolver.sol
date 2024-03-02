// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IAddressResolver {
    struct SmartAccountResult {
        address accountAddress;
        address factoryAddress;
        address currentImplementation;
        string currentVersion;
        string factoryVersion;
        uint256 deploymentIndex;
    }

    /**
     * @dev Returns the addresses of all the smart accounts deployed by the EOA for any deployment index from 0 to _maxIndex.
     * @param _eoa Address of the EOA.
     * @param _maxIndex Maximum index to check.
     * @notice This function is only for V1 Biconomy smart accounts.
     */
    function resolveAddressesV1(
        address _eoa,
        uint8 _maxIndex
    ) external view returns (SmartAccountResult[] memory);

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
    ) external view returns (SmartAccountResult[] memory);

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
    ) external view returns (SmartAccountResult[] memory);
}
