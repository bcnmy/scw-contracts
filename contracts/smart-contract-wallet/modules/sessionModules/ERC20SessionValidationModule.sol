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
        address sessionKey = address(bytes20(_data[0:20]));
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
        bytes calldata data;
        {
            uint256 offset = uint256(bytes32(_op.callData[4 + 64:4 + 96]));
            uint256 length = uint256(
                bytes32(_op.callData[4 + offset:4 + offset + 32])
            );
            data = _op.callData[4 + offset + 32:4 + offset + 32 + length];
        }
        if (address(bytes20(data[12:32])) != recipient) {
            return false;
        }
        if (uint256(bytes32(data[32:64])) > maxAmount) {
            return false;
        }
        return ECDSA.recover(_userOpHash, _sig) == sessionKey;
    }
}
