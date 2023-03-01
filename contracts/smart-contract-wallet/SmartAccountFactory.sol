// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "./Proxy.sol";
import "./BaseSmartAccount.sol"; 

// @todo review
contract SmartAccountFactory {
    // may emit/note create2 computed salt
    event AccountCreation(address indexed account, address indexed accountLogic, address indexed handler, address owner, uint256 index);

    /// @dev Allows to retrieve the creation code used for the Proxy deployment.
    function accountCreationCode() public pure returns (bytes memory) {
        return type(Proxy).creationCode;
    }

    // instead of passing handler might pass initializer data but then it has to be part of salt
    /**
     * @notice Deploys wallet using create2 and points it to _implementation
     * @param _implementation accountLogic proxy is going point to
     * @param _handler default fallback handler
     * @param _owner EOA signatory of the wallet
     * @param _index extra salt that allows to deploy more wallets if needed for same EOA (default 0)
     */
    function deployCounterFactualWallet(address _implementation, address _handler, address _owner, uint256 _index) public returns(address proxy){
        // check optimisation scope in creating salt...
        bytes32 salt = keccak256(abi.encodePacked(_handler, _owner, address(uint160(_index))));

        bytes memory deploymentData = abi.encodePacked(type(Proxy).creationCode, uint256(uint160(_implementation)));

        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create2(0x0, add(0x20, deploymentData), mload(deploymentData), salt)
        }
        require(address(proxy) != address(0), "Create2 call failed");

        // marked for deletion
        // calldata for init method
        /*if (initializer.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                if eq(call(gas(), proxy, 0, add(initializer, 0x20), mload(initializer), 0, 0), 0) {
                    revert(0, 0)
                }
            }
        }*/

        // you can pass initializer data but then that it also needs to be part of salt
        // init method name subject to change
        BaseSmartAccount(proxy).init(_owner, _handler);

        emit AccountCreation(proxy, _implementation, _handler, _owner, _index);
    }

    /**
     * @notice Deploys wallet using create and points it to _implementation
     * @param _implementation accountLogic proxy is going point to
     * @param _handler default fallback handler
     * @param _owner EOA signatory of the wallet
    */ 
    function deployWallet(address _implementation, address _handler, address _owner) public returns(address proxy){ 
        bytes memory deploymentData = abi.encodePacked(type(Proxy).creationCode, uint256(uint160(_implementation)));

        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create(0x0, add(0x20, deploymentData), mload(deploymentData))
        }
        require(address(proxy) != address(0), "Create call failed");

        // you can pass initializer data but then that it also needs to be part of salt
        // init method name subject to change
        BaseSmartAccount(proxy).init(_owner, _handler);

        emit AccountCreation(proxy, _implementation, _handler, _owner, 0);
    }

    /**
     * @notice Allows to find out wallet address prior to deployment
     * @param _implementation accountLogic proxy is going point to
     * @param _handler default fallback handler
     * @param _owner EOA signatory of the wallet
     * @param _index extra salt that allows to deploy more wallets if needed for same EOA (default 0)
    */
    function getAddressForCounterfactualWallet(address _implementation, address _handler, address _owner, uint256 _index) external view returns (address _wallet) {
       bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint256(uint160(_implementation)));
       bytes32 salt = keccak256(abi.encodePacked(_handler, _owner, address(uint160(_index))));
       bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code)));
        _wallet = address(uint160(uint(hash)));
    }

    // off-chain calculation
    // return ethers.utils.getCreate2Address(<factory address>, <create2 salt>, ethers.utils.keccak256(creationCode + implementation));

}