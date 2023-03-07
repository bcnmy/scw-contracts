// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./Proxy.sol";
import "./BaseSmartAccount.sol";
import {SmartAccountFactoryErrors} from "./common/Errors.sol"; 

// @todo review
contract SmartAccountFactory {
    address public immutable basicImplementation;
    address public immutable minimalHandler;

    // may emit/note create2 computed salt
    event AccountCreation(address indexed account, address indexed implementation, address indexed owner, uint256 index);

    constructor(address _basicImplementation, address _minimalHandler) {
        require(_basicImplementation != address(0), "implementation cannot be zero");
        require(_minimalHandler != address(0), "default handler cannot be zero");
        basicImplementation = _basicImplementation;
        minimalHandler = _minimalHandler;
    } 

    /// @dev Allows to retrieve the creation code used for the Proxy deployment.
    function accountCreationCode() public pure returns (bytes memory) {
        return type(Proxy).creationCode;
    }

    /**
     * @notice Deploys wallet using create2 and points it to basicImplementation
     * @param _owner EOA signatory for the account to be deployed
     * @param _index extra salt that allows to deploy more wallets if needed for same EOA (default 0)
     */
    function deployCounterFactualWallet(address _owner, uint256 _index) public returns(address proxy){
        // check optimisation scope in creating salt...
        bytes32 salt = keccak256(abi.encodePacked(_owner, address(uint160(_index))));

        bytes memory deploymentData = abi.encodePacked(type(Proxy).creationCode, uint256(uint160(basicImplementation)));

        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create2(0x0, add(0x20, deploymentData), mload(deploymentData), salt)
        }
        require(address(proxy) != address(0), "Create2 call failed");

        // todo create initializer data based on init method, _owner and minimalHandler
        // calldata for init method
        /*if (initializer.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                if eq(call(gas(), proxy, 0, add(initializer, 0x20), mload(initializer), 0, 0), 0) {
                    revert(0, 0)
                }
            }
        }*/

        // for simplicity as we lose the freedom now for initializer to be anything
        BaseSmartAccount(proxy).init(_owner, minimalHandler);

        emit AccountCreation(proxy, basicImplementation, _owner, _index);
    }

    /**
     * @notice Deploys wallet using create and points it to _implementation
     * @param _owner EOA signatory for the account to be deployed
    */ 
    function deployWallet(address _owner) public returns(address proxy){ 
        bytes memory deploymentData = abi.encodePacked(type(Proxy).creationCode, uint256(uint160(basicImplementation)));

        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create(0x0, add(0x20, deploymentData), mload(deploymentData))
        }
        require(address(proxy) != address(0), "Create call failed");

        // calldata for init method
        /*if (initializer.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                if eq(call(gas(), proxy, 0, add(initializer, 0x20), mload(initializer), 0, 0), 0) {
                    revert(0, 0)
                }
            }
        }*/

        // for simplicity as we lose the freedom now for initializer to be anything
        BaseSmartAccount(proxy).init(_owner, minimalHandler);

        // possibly emit a different event
    }

    /**
     * @notice Allows to find out wallet address prior to deployment
     * @param _owner EOA signatory for the account to be deployed
     * @param _index extra salt that allows to deploy more wallets if needed for same EOA (default 0)
    */
    function getAddressForCounterfactualWallet(address _owner, uint256 _index) external view returns (address _wallet) {
       bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint256(uint160(basicImplementation)));
       bytes32 salt = keccak256(abi.encodePacked(_owner, address(uint160(_index))));
       bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code)));
        _wallet = address(uint160(uint256(hash)));
    }
    // off-chain calculation
    // return ethers.utils.getCreate2Address(<factory address>, <create2 salt>, ethers.utils.keccak256(creationCode + implementation));

}