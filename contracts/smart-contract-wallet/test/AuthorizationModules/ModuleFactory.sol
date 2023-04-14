// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Proxy} from "./Proxy.sol";

/**
 * @title Module Factory - factory responsible for deploying Modules using CREATE2 and CREATE
 * @dev It deploys Modules as proxies. For each module pointing to the same implementation (using the same logic)
 *      and having the same data for initialization (that can mean this module is for the same Smart Account or has the
 *      same access control parameters, such as passkeys), the same address will be generated accross chains.
 * @author Chirag Titiya - <chirag@biconomy.io>
 */
contract ModuleFactory {
    // address public immutable implementation;

    event ModuleCreation(address proxy, address implementation);

    /**
     * @dev Allows to retrieve the creation code used for the Proxy deployment.
     * @return The creation code for the Proxy.
     */
    function proxyCreationCode() public pure returns (bytes memory) {
        return type(Proxy).creationCode;
    }

    /**
     * @notice Deploys module using create2 and points it to _implementation\
     * @dev    Сan not be frontrun, as resulting address is based on _implementation and _initData
     * @dev    There's no need of index: if module should be unique for every Smart Account, then _initData
     *         will be unique ensuring unique addresses for all the instances of same module
     *         (Proxies that use same implementation). If module has no unique _initData, it can be used
     *         with all the Smart Accounts and there's no need deploying new Proxy for each of them.
     * @param _implementation Module logic
     * @param _initData Calldata to initialize the newly deployed module.
     */
    function deployCounterFactualModule(
        address _implementation,
        bytes memory _initData
    ) public returns (address proxy) {
        bytes32 salt = keccak256(_initData);

        bytes memory deploymentData = abi.encodePacked(
            type(Proxy).creationCode,
            uint256(uint160(_implementation))
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

        // init Module
        if (_initData.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                if eq(
                    call(
                        gas(),
                        proxy,
                        0,
                        add(_initData, 0x20),
                        mload(_initData),
                        0,
                        0
                    ),
                    0
                ) {
                    revert(0, 0)
                }
            }
        }
        emit ModuleCreation(proxy, _implementation);
    }

    /**
     * @notice Deploys module using create and points it to _implementation
     * @param _implementation Module logic
     * @param _initData Calldata to initialize the newly deployed module.
     * @return proxy address of the deployed module
     */
    function deployAccount(
        address _implementation,
        bytes memory _initData
    ) public returns (address proxy) {
        bytes memory deploymentData = abi.encodePacked(
            type(Proxy).creationCode,
            uint256(uint160(_implementation))
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

        // calldata for init method
        if (_initData.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                if eq(
                    call(
                        gas(),
                        proxy,
                        0,
                        add(_initData, 0x20),
                        mload(_initData),
                        0,
                        0
                    ),
                    0
                ) {
                    revert(0, 0)
                }
            }
        }
        emit ModuleCreation(proxy, _implementation);
    }

    /**
     * @notice Allows to find out account address prior to deployment
     * @param _implementation Module logic
     * @param _initData Calldata to initialize the newly deployed module.
     */
    function getAddressForCounterFactualModule(
        address _implementation,
        bytes memory _initData
    ) external view returns (address _account) {
        bytes memory code = abi.encodePacked(
            type(Proxy).creationCode,
            uint256(uint160(_implementation))
        );
        bytes32 salt = keccak256(_initData);
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code))
        );
        _account = address(uint160(uint256(hash)));
    }
    // off-chain calculation
    // return ethers.utils.getCreate2Address(<factory address>, <create2 salt>, ethers.utils.keccak256(creationCode + implementation));
}
