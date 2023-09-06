// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./Proxy.sol";
import "./BaseSmartAccountV1.sol";
import {DefaultCallbackHandler} from "../../../handler/DefaultCallbackHandler.sol";

/**
 * @title Smart Account Factory - factory responsible for deploying Smart Accounts using CREATE2 and CREATE
 * @dev It deploys Smart Accounts as proxies pointing to `basicImplementation` that is immutable.
 *      This allows keeping the same address for the same Smart Account owner on various chains via CREATE2
 * @author Chirag Titiya - <chirag@biconomy.io>
 */
contract SmartAccountFactoryV1 {
    address public immutable basicImplementation;
    DefaultCallbackHandler public immutable minimalHandler;

    event AccountCreation(
        address indexed account,
        address indexed owner,
        uint256 indexed index
    );
    event AccountCreationWithoutIndex(
        address indexed account,
        address indexed owner
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
     * @notice Deploys account using create2 and points it to basicImplementation
     * @param _owner EOA signatory for the account to be deployed
     * @param _index extra salt that allows to deploy more account if needed for same EOA (default 0)
     */
    function deployCounterFactualAccount(
        address _owner,
        uint256 _index
    ) public returns (address proxy) {
        // create initializer data based on init method, _owner and minimalHandler
        bytes memory initializer = getInitializer(_owner);

        bytes32 salt = keccak256(
            abi.encodePacked(keccak256(initializer), _index)
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

        // calldata for init method
        if (initializer.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                if eq(
                    call(
                        gas(),
                        proxy,
                        0,
                        add(initializer, 0x20),
                        mload(initializer),
                        0,
                        0
                    ),
                    0
                ) {
                    revert(0, 0)
                }
            }
        }
        emit AccountCreation(proxy, _owner, _index);
    }

    /**
     * @dev Allows to retrieve the creation code used for the Proxy deployment.
     * @return The creation code for the Proxy.
     */
    function accountCreationCode() public pure returns (bytes memory) {
        return type(Proxy).creationCode;
    }

    /**
     * @notice Deploys account using create and points it to _implementation
     * @param _owner EOA signatory for the account to be deployed
     * @return proxy address of the deployed account
     */
    function deployAccount(address _owner) public returns (address proxy) {
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

        bytes memory initializer = getInitializer(_owner);

        // calldata for init method
        if (initializer.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                if eq(
                    call(
                        gas(),
                        proxy,
                        0,
                        add(initializer, 0x20),
                        mload(initializer),
                        0,
                        0
                    ),
                    0
                ) {
                    revert(0, 0)
                }
            }
        }
        emit AccountCreationWithoutIndex(proxy, _owner);
    }

    /**
     * @dev Allows to retrieve the initializer data for the account.
     * @param _owner EOA signatory for the account to be deployed
     * @return initializer bytes for init method
     */
    function getInitializer(
        address _owner
    ) internal view returns (bytes memory) {
        return
            abi.encodeCall(
                BaseSmartAccount.init,
                (_owner, address(minimalHandler))
            );
    }

    /**
     * @notice Allows to find out account address prior to deployment
     * @param _owner EOA signatory for the account to be deployed
     * @param _index extra salt that allows to deploy more accounts if needed for same EOA (default 0)
     */
    function getAddressForCounterFactualAccount(
        address _owner,
        uint256 _index
    ) external view returns (address _account) {
        // create initializer data based on init method, _owner and minimalHandler
        bytes memory initializer = getInitializer(_owner);
        bytes memory code = abi.encodePacked(
            type(Proxy).creationCode,
            uint256(uint160(basicImplementation))
        );
        bytes32 salt = keccak256(
            abi.encodePacked(keccak256(initializer), _index)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code))
        );
        _account = address(uint160(uint256(hash)));
    }
    // off-chain calculation
    // return ethers.utils.getCreate2Address(<factory address>, <create2 salt>, ethers.utils.keccak256(creationCode + implementation));
}
