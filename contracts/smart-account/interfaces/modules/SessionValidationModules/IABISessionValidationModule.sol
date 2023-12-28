// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../ISessionValidationModule.sol";

abstract contract IABISessionValidationModule is ISessionValidationModule {
    enum Condition {
        EQUAL,
        LESS_THAN_OR_EQUAL,
        LESS_THAN,
        GREATER_THAN_OR_EQUAL,
        GREATER_THAN,
        NOT_EQUAL
    }

    struct Rule {
        uint256 offset;
        bytes32 value;
        Condition condition;
    }

    struct Permission {
        address destinationContract;
        bytes4 selector;
        uint256 valueLimit;
        Rule[] rules;
    }
}
