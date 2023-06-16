// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "./ISessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract ERC20SessionValidationModule {
    function validateSessionUserOp(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _data,
        bytes calldata _sig
    ) external view returns (bool) {
        // _data is SessionKey data, that describes sessionKey permissions
        address sessionKey = address(bytes20(_data[0:20]));
        // 20:40 is token address
        address recipient = address(bytes20(_data[40:60]));
        uint256 maxAmount = abi.decode(_data[60:92], (uint256));
        {
            address token = address(bytes20(_data[20:40]));
            (address tokenAddr, uint256 amount, ) = abi.decode(
                _op.callData[4:],
                (address, uint256, bytes)
            );
            if (tokenAddr != token) {
                return false;
            }
            if (amount > 0) {
                return false;
            }
        }
        // working with userOp.callData
        // need to check if the call is to the allowed recepient and amount is not more than allowed
        bytes calldata data;
        {
            uint256 offset = uint256(bytes32(_op.callData[4 + 64:4 + 96]));
            uint256 length = uint256(
                bytes32(_op.callData[4 + offset:4 + offset + 32])
            );
            data = _op.callData[4 + offset + 32:4 + offset + 32 + length];
        }
        if (address(bytes20(data[16:36])) != recipient) {
            return false;
        }
        if (uint256(bytes32(data[36:68])) > maxAmount) {
            return false;
        }
        return
            ECDSA.recover(ECDSA.toEthSignedMessageHash(_userOpHash), _sig) ==
            sessionKey;
    }
}
