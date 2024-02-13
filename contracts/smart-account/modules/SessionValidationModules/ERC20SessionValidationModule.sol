// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import "../../interfaces/modules/ISessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ERC20 Session Validation Module for Biconomy Smart Accounts.
 * @dev Validates userOps for ERC20 transfers and approvals using a session key signature.
 *         - Recommended to use with standard ERC20 tokens only
 *         - Can be used with any method of any contract which implement
 *           method(address, uint256) interface
 *
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */
contract ERC20SessionValidationModule is ISessionValidationModule {
    mapping(bytes32 => mapping(address => uint256)) internal usageCounters;

    /**
     * @dev validates that the call (destinationContract, callValue, funcCallData)
     * complies with the Session Key permissions represented by sessionKeyData
     * @param destinationContract address of the contract to be called
     * @param callValue value to be sent with the call
     * @param _funcCallData the data for the call. is parsed inside the SVM
     * @param _sessionKeyData SessionKey data, that describes sessionKey permissions
     * param _callSpecificData additional data.
     * for example to store a list of allowed tokens or receivers
     */
    function validateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes calldata _funcCallData,
        bytes calldata _sessionKeyData,
        bytes calldata /*_callSpecificData */
    ) external virtual override returns (address) {
        return
            _validateSessionParams(
                destinationContract,
                callValue,
                _funcCallData,
                _sessionKeyData
            );
    }

    /**
     * @dev validates if the _op (UserOperation) matches the SessionKey permissions
     * and that _op has been signed by this SessionKey
     * Please mind the decimals of your exact token when setting maxAmount
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
    ) external override returns (bool) {
        require(
            bytes4(_op.callData[0:4]) == EXECUTE_OPTIMIZED_SELECTOR ||
                bytes4(_op.callData[0:4]) == EXECUTE_SELECTOR,
            "ERC20SV Invalid Selector"
        );

        (address tokenAddr, uint256 callValue, ) = abi.decode(
            _op.callData[4:], // skip selector
            (address, uint256, bytes)
        );
        bytes calldata data;
        {
            //offset represents where does the inner bytes array start
            uint256 offset = uint256(bytes32(_op.callData[4 + 64:4 + 96]));
            uint256 length = uint256(
                bytes32(_op.callData[4 + offset:4 + offset + 32])
            );
            //we expect data to be the `IERC20.transfer(address, uint256)` calldata
            data = _op.callData[4 + offset + 32:4 + offset + 32 + length];
        }

        return
            _validateSessionParams(
                tokenAddr,
                callValue,
                data,
                _sessionKeyData
            ) ==
            ECDSA.recover(
                ECDSA.toEthSignedMessageHash(_userOpHash),
                _sessionKeySignature
            );
    }

    function getUsageCounter(
        bytes32 sessionKeyDataHash,
        address smartAccount
    ) external view returns (uint256) {
        return usageCounters[sessionKeyDataHash][smartAccount];
    }

    /**
     * @dev Internal function to validate the session parameters
     * @param destinationContract address of the contract to be called
     * @param callValue value to be sent with the call
     * @param _funcCallData the data for the call. is parsed inside the SVM
     * @param _sessionKeyData SessionKey data, that describes sessionKey permissions
     * @return sessionKey address of the sessionKey
     */
    function _validateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes calldata _funcCallData,
        bytes calldata _sessionKeyData
    ) internal returns (address) {
        (
            address sessionKey,
            address token,
            address recipient,
            uint256 maxAmount,
            uint256 maxUsage
        ) = abi.decode(
                _sessionKeyData,
                (address, address, address, uint256, uint256)
            );

        address userOpSender = address(uint160(maxUsage >> 64));
        maxUsage = uint64(maxUsage);
        require(destinationContract == token, "ERC20SV Wrong Token");
        require(callValue == 0, "ERC20SV Non Zero Value");

        (address recipientCalled, uint256 amount) = abi.decode(
            _funcCallData[4:],
            (address, uint256)
        );

        require(recipient == recipientCalled, "ERC20SV Wrong Recipient");
        require(amount <= maxAmount, "ERC20SV Max Amount Exceeded");
        bytes32 sessionKeyDataHash = keccak256(_sessionKeyData);
        if (usageCounters[sessionKeyDataHash][userOpSender] >= maxUsage) {
            revert("ERC20SV Max Usage Exceeded");
        }
        ++usageCounters[sessionKeyDataHash][userOpSender];
        return sessionKey;
    }
}
