// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "./ISessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// import "hardhat/console.sol";

contract ERC721ApprovalSessionValidationModule {
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
        address sessionKey = address(bytes20(_sessionKeyData[0:20]));
        address nftContract = address(bytes20(_sessionKeyData[20:40]));

        // we expect _op.callData to be `SmartAccount.executeCall(to, value, calldata)` calldata
        (address tokenAddr, uint256 callValue, ) = abi.decode(
            _op.callData[4:], // skip selector
            (address, uint256, bytes)
        );

        (bytes4 selector, bool approved) = _getApprovalForAllData(
            _op.callData[100:]
        );

        if (tokenAddr != nftContract) {
            revert("ERC721SV Wrong NFT contract");
        }
        if (callValue > 0) {
            revert("ERC721SV Non Zero Value");
        }
        if (selector != bytes4(0xa22cb465)) {
            revert("ERC721SV Not Approval For All");
        }
        if (!approved) {
            revert("ERC721SV False value");
        }
        return
            ECDSA.recover(
                ECDSA.toEthSignedMessageHash(_userOpHash),
                _sessionKeySignature
            ) == sessionKey;
    }

    function _getApprovalForAllData(
        bytes calldata _approvalForAllCalldata
    ) internal view returns (bytes4 selector, bool approved) {
        //first 32 bytes is the length of bytes array
        selector = bytes4(_approvalForAllCalldata[32:36]);
        //36:68 is the address of the operator
        approved = (uint256(bytes32(_approvalForAllCalldata[68:100])) == 1);
    }
}
