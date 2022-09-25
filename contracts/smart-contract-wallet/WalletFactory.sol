// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

//import "@openzeppelin/contracts/proxy/Clones.sol";
import "./Proxy.sol";
import "./BaseSmartWallet.sol"; 

contract WalletFactory {
    address internal _defaultImpl; 

    // EOA + Version tracking
    string public constant VERSION = "1.0.1"; // Forward enabled refund enhancements

    //states : registry
    mapping (address => bool) public isWalletExist;

    constructor(address _baseImpl) {
        require(_baseImpl != address(0), "base wallet address can not be zero");
        _defaultImpl = _baseImpl;
    }

    // event WalletCreated(address indexed _proxy, address indexed _implementation, address indexed _owner);
    // EOA + Version tracking
    event WalletCreated(address indexed _proxy, address indexed _implementation, address indexed _owner, string version, uint256 _index);

    /**
     * @notice Deploys wallet using create2 and points it to _defaultImpl
     * @param _owner EOA signatory of the wallet
     * @param _entryPoint AA 4337 entry point address
     * @param _handler fallback handler address
     * @param _index extra salt that allows to deploy more wallets if needed for same EOA (default 0)
     */
    function deployCounterFactualWallet(address _owner, address _entryPoint, address _handler, uint _index) public returns(address proxy){
        bytes32 salt = keccak256(abi.encodePacked(_owner, address(uint160(_index))));
        bytes memory deploymentData = abi.encodePacked(type(Proxy).creationCode, uint(uint160(_defaultImpl)));
        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create2(0x0, add(0x20, deploymentData), mload(deploymentData), salt)
        }
        require(address(proxy) != address(0), "Create2 call failed");
        // EOA + Version tracking
        emit WalletCreated(proxy,_defaultImpl,_owner, VERSION, _index);
        BaseSmartWallet(proxy).init(_owner, _entryPoint, _handler);
        isWalletExist[proxy] = true;
    }

    /**
     * @notice Deploys wallet using create and points it to _defaultImpl
     * @param _owner EOA signatory of the wallet
     * @param _entryPoint AA 4337 entry point address
     * @param _handler fallback handler address
    */ 
    function deployWallet(address _owner, address _entryPoint, address _handler) public returns(address proxy){ 
        bytes memory deploymentData = abi.encodePacked(type(Proxy).creationCode, uint(uint160(_defaultImpl)));
        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create(0x0, add(0x20, deploymentData), mload(deploymentData))
        }
        BaseSmartWallet(proxy).init(_owner, _entryPoint, _handler);
        isWalletExist[proxy] = true;
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