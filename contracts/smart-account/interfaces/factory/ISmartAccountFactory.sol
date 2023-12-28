// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.23;

/**
 * @title Smart Account Factory - factory responsible for deploying Smart Accounts using CREATE2 and CREATE
 * @dev It deploys Smart Accounts as proxies pointing to `basicImplementation` that is immutable.
 *      This allows keeping the same address for the same Smart Account owner on various chains via CREATE2
 * @author Chirag Titiya - <chirag@biconomy.io>
 */
interface ISmartAccountFactory {
    // Events
    event AccountCreation(
        address indexed account,
        address indexed initialAuthModule,
        uint256 indexed index
    );
    event AccountCreationWithoutIndex(
        address indexed account,
        address indexed initialAuthModule
    );

    /**
     * @notice Deploys account using create2 and points it to basicImplementation
     * @param moduleSetupContract address of the module setup contract
     * @param moduleSetupData data for module setup contract
     * @param index extra salt that allows to deploy more account if needed for same EOA (default 0)
     * @return proxy address of the deployed account
     */
    function deployCounterFactualAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData,
        uint256 index
    ) external returns (address proxy);

    /**
     * @notice Deploys account using create and points it to _implementation
     * @param moduleSetupContract address of the module setup contract
     * @param moduleSetupData data for module setup contract
     * @return proxy address of the deployed account
     */
    function deployAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) external returns (address proxy);

    /**
     * @notice Allows to find out account address prior to deployment
     * @param moduleSetupContract address of the module setup contract
     * @param moduleSetupData data for module setup contract
     * @param index extra salt that allows to deploy more accounts if needed for same EOA (default 0)
     * @return _account address of the account
     */
    function getAddressForCounterFactualAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData,
        uint256 index
    ) external view returns (address _account);

    /**
     * @dev Allows to retrieve the creation code used for the Proxy deployment.
     * @return The creation code for the Proxy.
     */
    function accountCreationCode() external pure returns (bytes memory);
}
