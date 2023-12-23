// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {UserOperation} from "aa-core/EntryPoint.sol";
import {ISessionKeyManagerModuleHybrid} from "sa/interfaces/modules/SessionKeyManagers/ISessionKeyManagerModuleHybrid.sol";

abstract contract AssertUtils is Test {
    function assertEq(
        ISessionKeyManagerModuleHybrid.SessionData memory _a,
        ISessionKeyManagerModuleHybrid.SessionData memory _b
    ) internal {
        assertEq(_a.validUntil, _b.validUntil, "mismatched validUntil");
        assertEq(_a.validAfter, _b.validAfter, "mismatched validAfter");
        assertEq(
            _a.sessionValidationModule,
            _b.sessionValidationModule,
            "mismatched sessionValidationModule"
        );
        assertEq(
            _a.sessionKeyData,
            _b.sessionKeyData,
            "mismatched sessionKeyData"
        );
    }
}
