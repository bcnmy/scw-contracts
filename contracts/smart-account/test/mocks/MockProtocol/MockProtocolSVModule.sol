// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "../../../modules/SessionValidationModules/ISessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MockProtocolSVM is ISessionValidationModule {
    function validateSessionUserOp(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _sessionKeyData,
        bytes calldata _sessionKeySignature
    ) external pure override returns (bool) {
        require(
            bytes4(_op.callData[0:4]) == EXECUTE_OPTIMIZED_SELECTOR ||
                bytes4(_op.callData[0:4]) == EXECUTE_SELECTOR,
            "ERC20SV Invalid Selector"
        );

        (
            address sessionKey,
            address protocol,
            address token,
            uint256 maxAmount
        ) = abi.decode(_sessionKeyData, (address, address, address, uint256));

        {
            // we expect _op.callData to be `SmartAccount.execute(to, value, calldata)` calldata
            (address protocolCalled, uint256 callValue, ) = abi.decode(
                _op.callData[4:], // skip selector
                (address, uint256, bytes)
            );
            if (protocolCalled != protocol) {
                revert("ERC20SV Wrong Protocol");
            }
            if (callValue != 0) {
                revert("ERC20SV Non Zero Value");
            }
        }
        // working with userOp.callData
        // check if the interaction is with an allowed token and amount is not more than allowed
        bytes calldata data;
        {
            uint256 offset = uint256(bytes32(_op.callData[4 + 64:4 + 96]));
            uint256 length = uint256(
                bytes32(_op.callData[4 + offset:4 + offset + 32])
            );
            //we expect data to be the `Protocol.interact(address token, uint256 amount)` calldata
            data = _op.callData[4 + offset + 32:4 + offset + 32 + length];
        }
        if (address(bytes20(data[16:36])) != token) {
            revert("ERC20SV Wrong Token");
        }
        if (uint256(bytes32(data[36:68])) > maxAmount) {
            revert("ERC20SV Max Amount Exceeded");
        }
        return
            ECDSA.recover(
                ECDSA.toEthSignedMessageHash(_userOpHash),
                _sessionKeySignature
            ) == sessionKey;
    }

    function validateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes calldata _funcCallData,
        bytes calldata _sessionKeyData,
        bytes calldata /*callSpecificData*/
    ) external virtual override returns (address) {
        (
            address sessionKey,
            address protocol,
            address token,
            uint256 maxAmount
        ) = abi.decode(_sessionKeyData, (address, address, address, uint256));

        require(
            destinationContract == protocol,
            "Mock Prot SVM: Invalid Protocol"
        );
        require(callValue == 0, "Mock Prot SVM: Non Zero Value");

        (address tokenAddr, uint256 amount) = abi.decode(
            _funcCallData[4:],
            (address, uint256)
        );

        require(tokenAddr == token, "Mock Prot SVM: Wrong Token");
        require(amount <= maxAmount, "Mock Prot SVM: Max Amount Exceeded");

        return sessionKey;
    }
}
