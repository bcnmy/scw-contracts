// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../Proxy.sol";
import "../BaseSmartAccount.sol";
import {DefaultCallbackHandler} from "../handler/DefaultCallbackHandler.sol";
import {Stakeable} from "../common/Stakeable.sol";
import {ISmartAccountFactory} from "../interfaces/factory/ISmartAccountFactory.sol";

/**
 * @title Smart Account Factory - factory responsible for deploying Smart Accounts using CREATE2 and CREATE
 * @dev It deploys Smart Accounts as proxies pointing to `basicImplementation` that is immutable.
 *      This allows keeping the same address for the same Smart Account owner on various chains via CREATE2
 * @author Chirag Titiya - <chirag@biconomy.io>
 */
contract SmartAccountFactory is Stakeable, ISmartAccountFactory {
    address public immutable basicImplementation;
    DefaultCallbackHandler public immutable minimalHandler;

    constructor(
        address _basicImplementation,
        address _newOwner
    ) Stakeable(_newOwner) {
        require(
            _basicImplementation != address(0),
            "implementation cannot be zero"
        );
        basicImplementation = _basicImplementation;
        minimalHandler = new DefaultCallbackHandler();
    }

    /// @inheritdoc ISmartAccountFactory
    function getAddressForCounterFactualAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData,
        uint256 index
    ) external view override returns (address _account) {
        // create initializer data based on init method, _owner and minimalHandler
        bytes memory initializer = _getInitializer(
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

    /// @inheritdoc ISmartAccountFactory
    function deployCounterFactualAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData,
        uint256 index
    ) public override returns (address proxy) {
        // create initializer data based on init method and parameters
        bytes memory initializer = _getInitializer(
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
        emit AccountCreation(proxy, initialAuthorizationModule, index);
    }

    /// @inheritdoc ISmartAccountFactory
    function deployAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) public override returns (address proxy) {
        bytes memory deploymentData = abi.encodePacked(
            type(Proxy).creationCode,
            uint256(uint160(basicImplementation))
        );

        assembly {
            proxy := create(
                0x0,
                add(0x20, deploymentData),
                mload(deploymentData)
            )
        }
        require(address(proxy) != address(0), "Create call failed");

        bytes memory initializer = _getInitializer(
            moduleSetupContract,
            moduleSetupData
        );
        address initialAuthorizationModule;


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
        emit AccountCreationWithoutIndex(proxy, initialAuthorizationModule);
    }

    /// @inheritdoc ISmartAccountFactory
    function accountCreationCode() public pure override returns (bytes memory) {
        return type(Proxy).creationCode;
    }

    /**
     * @dev Allows to retrieve the initializer data for the account.
     * @param moduleSetupContract Initializes the auth module; can be a factory or registry for multiple accounts.
     * @param moduleSetupData modules setup data (a standard calldata for the module setup contract)
     * @return initializer bytes for init method
     */
    function _getInitializer(
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) internal view returns (bytes memory) {
        return
            abi.encodeCall(
                BaseSmartAccount.init,
                (address(minimalHandler), moduleSetupContract, moduleSetupData)
            );
    }
}
