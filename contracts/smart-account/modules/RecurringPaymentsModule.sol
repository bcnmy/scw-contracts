// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* solhint-disable no-unused-import */

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {IAuthorizationModule} from "../interfaces/IAuthorizationModule.sol";
import {ISmartAccount} from "../interfaces/ISmartAccount.sol";
import {Enum} from "../common/Enum.sol";

contract RecurringPaymentsModule {
    struct Subscription {
        address receiver;
        uint48 nextPaymentDue;
        uint48 subscriptionPeriod;
        uint256 paymentAmount;
        bytes callData;
    }

    string public constant NAME = "Recurring Payments Module";
    string public constant VERSION = "0.1.0";

    mapping(bytes32 => mapping(address => Subscription)) internal subscriptions;

    function initForSmartAccount(
        Subscription calldata sub
    ) external returns (address) {
        addSubscription(sub);
        return address(this);
    }

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32
    ) external virtual returns (uint256) {
        (address dest, , bytes memory data) = abi.decode(
            userOp.callData[4:],
            (address, uint256, bytes)
        );

        bytes4 innerSelector;
        assembly {
            innerSelector := mload(add(data, 0x20))
        }

        if (
            dest != address(this) ||
            innerSelector != this.executeRecurringPayment.selector
        ) revert("Not allowed call");
        // can add some manipulations with validUntil here based on sub period
        return 0; // SIG VALIDATION SUCCESS
    }

    function executeRecurringPayment(
        bytes32 subHash,
        address subscriber
    ) external {
        Subscription memory sub = subscriptions[subHash][subscriber];
        require(sub.receiver != address(0), "Subscription not found");
        require(sub.nextPaymentDue <= block.timestamp, "Payment not due yet");
        (bool success, ) = ISmartAccount(subscriber)
            .execTransactionFromModuleReturnData(
                sub.receiver,
                sub.paymentAmount,
                sub.callData,
                Enum.Operation.Call
            );
        if (!success) revert("Payment failed");
        subscriptions[subHash][subscriber].nextPaymentDue += sub
            .subscriptionPeriod;
    }

    function addSubscription(Subscription calldata sub) public {
        bytes32 subHash = keccak256(
            abi.encodePacked(
                sub.receiver,
                sub.nextPaymentDue,
                sub.subscriptionPeriod,
                sub.paymentAmount,
                sub.callData
            )
        );
        subscriptions[subHash][msg.sender] = sub;
    }

    function getSubHash(
        Subscription calldata sub
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    sub.receiver,
                    sub.nextPaymentDue,
                    sub.subscriptionPeriod,
                    sub.paymentAmount,
                    sub.callData
                )
            );
    }
}
