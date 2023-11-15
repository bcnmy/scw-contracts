// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* solhint-disable no-unused-import */

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {EIP1271_MAGIC_VALUE} from "contracts/smart-account/interfaces/ISignatureValidator.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IOrgUserAdminModule} from "../interfaces/modules/IOrgUserAdminModule.sol";
import {IAuthorizationModule} from "../interfaces/IAuthorizationModule.sol";
import {ISignatureValidator} from "../interfaces/ISignatureValidator.sol";

/**
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract OrgUserAdminModule
{
    // destination => smartAccount => selector => isAllowed
    mapping(address => mapping(address => mapping(bytes4 => bool))) internal _allowedDestinations1;

    // destinationContract => selector => smartAccount => isAllowed
    mapping(address => mapping(bytes4 => mapping(address => bool))) internal _allowedDestinations2;

    function initMappings(address destination, bytes4 selector) external {
        _allowedDestinations1[destination][msg.sender][selector] = true;
        _allowedDestinations2[destination][selector][msg.sender] = true;
    }

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 
    ) external view virtual returns (uint256) {

        (address destination, ,) = abi.decode(
                    userOp.callData[4:], // skip selector
                    (address, uint256, bytes)
                );
        bytes calldata data;

            {
                //offset represents where does the inner bytes array start
                uint256 offset = uint256(bytes32(userOp.callData[4 + 64:4 + 96]));
                uint256 length = uint256(
                    bytes32(userOp.callData[4 + offset:4 + offset + 32])
                );
                //we expect data to be the `IERC20.transfer(address, uint256)` calldata
                data = userOp.callData[4 + offset + 32:4 + offset + 32 + length];
            }

        // doesn't pass
        //bool res = _allowedDestinations1[destination][userOp.sender][bytes4(data[0:4])];

        // this passes
        bool res = _allowedDestinations2[destination][bytes4(data[0:4])][userOp.sender];
        
        if (res)    
            return 0;
        else
            return 1;
    }
    
}
