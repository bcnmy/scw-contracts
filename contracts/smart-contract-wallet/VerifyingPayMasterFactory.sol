// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./VerifyPayMasterProxy.sol";
import "../references/aa-4337/VerifyingPayMaster.sol"; 

contract VerifyingPayMasterFactory {
    address internal payMasterImp; 

    event VerifyingPayMasterCreated(address indexed proxy, address payMasterImp, IEntryPoint entryPoint, address indexed owner, address indexed verifyingSigner);

    constructor(address _payMasterImp) {
        require(_payMasterImp != address(0), "PayMaster address can not be zero");
        payMasterImp = _payMasterImp;
    }
    
    function deployVerifyingPayMaster(address owner, address verifyingSigner, IEntryPoint entryPoint) public returns(address proxy){
        bytes32 salt = keccak256(abi.encodePacked(verifyingSigner));
        bytes memory deploymentData = abi.encodePacked(type(VerifyPayMasterProxy).creationCode, uint(uint160(payMasterImp)));
        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxy := create2(0x0, add(0x20, deploymentData), mload(deploymentData), salt)
        }
        require(address(proxy) != address(0), "Create2 call failed");
        VerifyingPayMaster(proxy).init(entryPoint, owner, verifyingSigner);
        emit VerifyingPayMasterCreated(proxy, payMasterImp, entryPoint, owner, verifyingSigner);
    }
}