// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "./Proxy.sol";
import "./BaseSmartAccount.sol"; 

contract SmartAccountFactory {
    address immutable public _defaultImpl;
    address immutable public _defaultFallbackHandler; 

    // EOA + Version tracking
    string public constant VERSION = "1.0.4";

    //states : registry
    // review need and impact of this update wallet -> account
    mapping (address => bool) public isAccountExist;

    constructor(address _baseImpl, address _handler) {
        require(_baseImpl != address(0), "base wallet address 0");
        _defaultImpl = _baseImpl;
        require(_handler != address(0), "default fallback handler 0");
        _defaultFallbackHandler = _handler;
    }

    // Review event
    event SmartAccountCreated(address indexed _proxy, address indexed _implementation, address indexed _owner, string version, uint256 _index);

    /**
     * @notice Deploys wallet using create2 and points it to _defaultImpl
     * @param _owner EOA signatory of the wallet
     * @param _index extra salt that allows to deploy more wallets if needed for same EOA (default 0)
     */
    function deployCounterFactualWallet(address _owner, uint _index) public returns(address proxy){
        bytes32 salt = keccak256(abi.encodePacked(_owner, address(uint160(_index))));
        bytes memory deploymentData = abi.encodePacked(type(Proxy).creationCode, uint(uint160(_defaultImpl)));
        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create2(0x0, add(0x20, deploymentData), mload(deploymentData), salt)
        }
        require(address(proxy) != address(0), "Create2 call failed");
        // EOA + Version tracking
        emit SmartAccountCreated(proxy,_defaultImpl,_owner, VERSION, _index);
        BaseSmartAccount(proxy).init(_owner, _defaultFallbackHandler);
        isAccountExist[proxy] = true;
    }

    /**
     * @notice Deploys wallet using create and points it to _defaultImpl
     * @param _owner EOA signatory of the wallet
    */ 
    function deployWallet(address _owner) public returns(address proxy){ 
        bytes memory deploymentData = abi.encodePacked(type(Proxy).creationCode, uint(uint160(_defaultImpl)));
        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create(0x0, add(0x20, deploymentData), mload(deploymentData))
        }
        BaseSmartAccount(proxy).init(_owner, _defaultFallbackHandler);
        isAccountExist[proxy] = true;
    }

    /**
     * @notice Allows to find out wallet address prior to deployment
     * @param _owner EOA signatory of the wallet
     * @param _index extra salt that allows to deploy more wallets if needed for same EOA (default 0)
    */
    function getAddressForCounterfactualWallet(address _owner, uint _index) external view returns (address _wallet) {
       bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint(uint160(_defaultImpl)));
       bytes32 salt = keccak256(abi.encodePacked(_owner, address(uint160(_index))));
       bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code)));
        _wallet = address(uint160(uint(hash)));
    }

}