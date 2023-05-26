// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./Proxy.sol";
import "./BaseSmartAccount.sol";
import {DefaultCallbackHandler} from "./handler/DefaultCallbackHandler.sol";
import {SmartAccountFactoryErrors} from "./common/Errors.sol";

/**
 * @title Smart Account Factory - factory responsible for deploying Smart Accounts using CREATE2 and CREATE
 * @dev It deploys Smart Accounts as proxies pointing to `basicImplementation` that is immutable.
 *      This allows keeping the same address for the same Smart Account owner on various chains via CREATE2
 * @author Chirag Titiya - <chirag@biconomy.io>
 */
contract SmartAccountFactory {
    address public immutable basicImplementation;
    DefaultCallbackHandler public immutable minimalHandler;

    event AccountCreation(
        address indexed account,
        address indexed initialAuthModule,
        uint256 indexed index
    );
    event AccountCreationWithoutIndex(
        address indexed account,
        address indexed initialAuthModule
    );

    constructor(address _basicImplementation) {
        require(
            _basicImplementation != address(0),
            "implementation cannot be zero"
        );
        basicImplementation = _basicImplementation;
        minimalHandler = new DefaultCallbackHandler();
    }

    /**
     * @dev Allows to retrieve the creation code used for the Proxy deployment.
     * @return The creation code for the Proxy.
     */
    function accountCreationCode() public pure returns (bytes memory) {
        return type(Proxy).creationCode;
    }

    /**
     * @notice Deploys account using create2 and points it to basicImplementation
     *
     * @param index extra salt that allows to deploy more account if needed for same EOA (default 0)
     */
    function deployCounterFactualAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData,
        uint256 index
    ) public returns (address proxy) {
        // create initializer data based on init method and parameters
        bytes memory initializer = getInitializer(
            moduleSetupContract,
            moduleSetupData
        );
        bytes32 salt = keccak256(
            abi.encodePacked(keccak256(initializer), index)
        );

        bytes memory deploymentData = abi.encodePacked(
            type(Proxy).creationCode,
            uint256(uint160(basicImplementation))
        );

        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create2(
                0x0,
                add(0x20, deploymentData),
                mload(deploymentData),
                salt
            )
        }
        require(address(proxy) != address(0), "Create2 call failed");

        address initialAuthorizationModule;

        if (initializer.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                let success := call(
                    gas(),
                    proxy,
                    0,
                    add(initializer, 0x20),
                    mload(initializer),
                    0,
                    0
                )
                let ptr := mload(0x40)
                returndatacopy(ptr, 0, returndatasize())
                if iszero(success) {
                    revert(ptr, returndatasize())
                }
                initialAuthorizationModule := mload(ptr)
            }
        }
        emit AccountCreation(proxy, initialAuthorizationModule, index);
    }

    /**
     * @notice Deploys account using create and points it to _implementation
     
     * @return proxy address of the deployed account
     */
    function deployAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) public returns (address proxy) {
        bytes memory deploymentData = abi.encodePacked(
            type(Proxy).creationCode,
            uint256(uint160(basicImplementation))
        );

        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create(
                0x0,
                add(0x20, deploymentData),
                mload(deploymentData)
            )
        }
        require(address(proxy) != address(0), "Create call failed");

        bytes memory initializer = getInitializer(
            moduleSetupContract,
            moduleSetupData
        );
        address initialAuthorizationModule;

        if (initializer.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                let success := call(
                    gas(),
                    proxy,
                    0,
                    add(initializer, 0x20),
                    mload(initializer),
                    0,
                    0
                )
                let ptr := mload(0x40)
                returndatacopy(ptr, 0, returndatasize())
                if iszero(success) {
                    revert(ptr, returndatasize())
                }
                initialAuthorizationModule := mload(ptr)
            }
        }
        emit AccountCreationWithoutIndex(proxy, initialAuthorizationModule);
    }

    /**
     * @dev Allows to retrieve the initializer data for the account.
     * @param moduleSetupContract Contract, that setups initial auth module for this smart account. It can be a module factory or
     *                            a registry module that serves several smart accounts
     * @param moduleSetupData modules setup data (a standard calldata for the module setup contract)
     * @return initializer bytes for init method
     */
    function getInitializer(
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) internal view returns (bytes memory) {
        return
            abi.encodeCall(
                BaseSmartAccount.init,
                (address(minimalHandler), moduleSetupContract, moduleSetupData)
            );
    }

    /**
     * @notice Allows to find out account address prior to deployment
     * @param index extra salt that allows to deploy more accounts if needed for same EOA (default 0)
     */
    function getAddressForCounterFactualAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData,
        uint256 index
    ) external view returns (address _account) {
        // create initializer data based on init method, _owner and minimalHandler
        bytes memory initializer = getInitializer(
            moduleSetupContract,
            moduleSetupData
        );
        bytes memory code = abi.encodePacked(
            type(Proxy).creationCode,
            uint256(uint160(basicImplementation))
        );
        bytes32 salt = keccak256(
            abi.encodePacked(keccak256(initializer), index)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code))
        );
        _account = address(uint160(uint256(hash)));
    }
}
