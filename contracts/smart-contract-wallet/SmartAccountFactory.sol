// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "./Proxy.sol";
import "./BaseSmartAccount.sol"; 

// @todo
// cleanup comments and review notes below

contract SmartAccountFactory {
    address immutable public _implementation;
    address immutable public _defaultFallbackHandler; 
    // ^^ this means if defaultImpl or defaultFallbackHandler changes then we'd have to deploy new factory.
    // (as per currrent versioning) defaultImpl changes = version update in impl and proxy both 
    // defaultFallbackHandler changes = version update only in factory?!

    // should be needed to emit from accountLogic : SmartAccountInitialized
    // string public constant VERSION = "1.0.4";

     event AccountCreation(address indexed account, address indexed accountLogic);

    // not to check if address is a contract but if it's deployed from this proxy
    // mapping (address => bool) public isAccountExist;

    constructor(address _singleton, address _handler) {
        require(_singleton != address(0), "invalid singleton address");
        _implementation = _singleton;
        require(_handler != address(0), "invalid fallback handler");
        _defaultFallbackHandler = _handler;
    }

    /**
     * @dev Deploys wallet using create2 and points it to _implementation
     * @param _owner EOA signatory of the wallet
     * @param _index extra salt that allows to deploy more wallets if needed for same EOA (default 0)
     */
    function deployCounterFactualWallet(address _owner, uint256 _index) external returns(address proxy){
        // check optimisation scope in creating salt...
        bytes32 salt = keccak256(abi.encodePacked(_owner, address(uint160(_index))));

        bytes memory deploymentData = abi.encodePacked(type(Proxy).creationCode, uint256(uint160(_implementation)));

        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create2(0x0, add(0x20, deploymentData), mload(deploymentData), salt)
        }
        require(address(proxy) != address(0), "Create2 call failed");

        // can be emitted owner, index, handler, _defaultImpl
        // emit...

        // you can pass initializer data but then that it also needs to be part of salt
        // init method name subject to change
        BaseSmartAccount(proxy).init(_owner, _defaultFallbackHandler);
        // above emit.. can be mixed with AccountCreation
        emit AccountCreation(proxy, _implementation);
    }

    /**
     * @dev Deploys wallet using create and points it to _implementation
     * @param _owner EOA signatory of the wallet
    */ 
    function deployWallet(address _owner) external returns(address proxy){ 
        bytes memory deploymentData = abi.encodePacked(type(Proxy).creationCode, uint256(uint160(_implementation)));
        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create(0x0, add(0x20, deploymentData), mload(deploymentData))
        }
        require(address(proxy) != address(0), "Create call failed");

        // you can pass initializer data but then that it also needs to be part of salt
        // init method name subject to change
        BaseSmartAccount(proxy).init(_owner, _defaultFallbackHandler);
        emit AccountCreation(proxy, _implementation);
    }

    /**
     * @dev Allows to find out wallet address prior to deployment
     * @param _owner EOA signatory of the wallet
     * @param _index extra salt that allows to deploy more wallets if needed for same EOA (default 0)
    */
    function getAddressForCounterfactualWallet(address _owner, uint256 _index) external view returns (address _wallet) {
       bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint256(uint160(_implementation)));
       bytes32 salt = keccak256(abi.encodePacked(_owner, address(uint160(_index))));
       bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code)));
        _wallet = address(uint160(uint256(hash)));
    }

    /// @dev Allows to retrieve the creation code used for the Proxy deployment.
    function accountCreationCode() public pure returns (bytes memory) {
        return type(Proxy).creationCode;
    }

}