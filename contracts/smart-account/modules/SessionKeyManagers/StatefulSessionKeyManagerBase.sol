// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseAuthorizationModule} from "../BaseAuthorizationModule.sol";
import {IStatefulSessionKeyManagerBase} from "../../interfaces/modules/SessionKeyManagers/IStatefulSessionKeyManagerBase.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {IAuthorizationModule} from "../../interfaces/IAuthorizationModule.sol";
import {ISignatureValidator} from "../../interfaces/ISignatureValidator.sol";

/**
 * @title StatefulSessionKeyManagerBase
 * @dev Base contract for Session Key Manager Modules that store the session
 *      key data on-chain.
 *      These Session Key Manager module are typically optimised for L2s where calldata
 *      is expensive and hence session key data is stored on-chain.
 * @author Ankur Dubey - <ankur@biconomy.io>
 */
abstract contract StatefulSessionKeyManagerBase is
    BaseAuthorizationModule,
    IStatefulSessionKeyManagerBase
{
    mapping(bytes32 _sessionDataDigest => mapping(address _sa => SessionData data))
        internal _enabledSessionsData;

    /// @inheritdoc IAuthorizationModule
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual returns (uint256);

    /// @inheritdoc IStatefulSessionKeyManagerBase
    function disableSession(address _sa, bytes32 _sessionDigest) external {
        delete _enabledSessionsData[_sessionDigest][_sa];
        emit SessionDisabled(_sa, _sessionDigest);
    }

    /// @inheritdoc IStatefulSessionKeyManagerBase
    function enabledSessionsData(
        bytes32 _sessionDataDigest,
        address _sa
    ) external view override returns (SessionData memory data) {
        data = _enabledSessionsData[_sessionDataDigest][_sa];
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignature(
        bytes32 _dataHash,
        bytes memory _signature
    ) public pure virtual override returns (bytes4) {
        (_dataHash, _signature);
        return 0xffffffff; // do not support it here
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignatureUnsafe(
        bytes32 _dataHash,
        bytes memory _signature
    ) public pure virtual override returns (bytes4) {
        (_dataHash, _signature);
        return 0xffffffff; // do not support it here
    }
}
