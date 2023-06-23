// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;
import {IHooks} from "./IHooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "hardhat/console.sol";

contract SpendingLimitsModule is IHooks {
    // NOTE: This module is for demo purposes only. It is not audited and should not be used in production.
    // This implementation acts in an execution phase and is universal (handles any spending txns).

    // It can be implemented to act during validation phase. In this case it won't know the difference between balances before and after txn
    // In this case it can check if the userOp.callData is a transfer call and check the amount of the transfer
    // In this case it won't need to implement hooks at all, just validateUserOp() that checks the amount to be transferred and
    // compares it to the allowance left to spend

    //Per token
    address public immutable token;

    struct Spending {
        uint256 amount;
        uint256 timestamp;
    }

    struct Limit {
        uint256 limitAmount;
        uint256 period;
    }

    // smart account => (user => Spendings)
    mapping(address => mapping(address => Spending[])) userSpendings;
    // smart account => (user => limit)
    mapping(address => mapping(address => Limit)) userLimits;
    mapping(address => uint256) balancesBeforeTxn;

    constructor(address _token) {
        token = _token;
    }

    function preHook(
        address target,
        uint256 value,
        bytes memory data,
        address spender
    ) external {
        //console.log("preHook called at Spending Limits Module", address(this));
        balancesBeforeTxn[msg.sender] = IERC20(token).balanceOf(msg.sender); //called by SA
    }

    function postHook(
        address target,
        uint256 value,
        bytes memory data,
        address spender
    ) external {
        //console.log("postHook called at Spending Limits Module", address(this));
        uint256 balanceAfterTxn = IERC20(token).balanceOf(msg.sender); //as it is called by the smart account
        /* console.log("balancesBeforeTxn   ", balancesBeforeTxn[msg.sender]);
        console.log("balanceAfterTxn     ", balanceAfterTxn);
        console.log(
            "spendings for period",
            calculateSpendingsForPeriod(msg.sender, spender)
        );
        console.log(
            "limitAmount         ",
            userLimits[msg.sender][spender].limitAmount
        ); */

        uint256 leftToSpend = userLimits[msg.sender][spender].limitAmount -
            calculateSpendingsForPeriod(msg.sender, spender);

        /* console.log("allowance           ", leftToSpend);
        console.log(
            "txn spending        ",
            balancesBeforeTxn[msg.sender] - balanceAfterTxn
        ); */

        if (balanceAfterTxn < balancesBeforeTxn[msg.sender]) {
            //it is a spending txn
            if (balancesBeforeTxn[msg.sender] - balanceAfterTxn > leftToSpend) {
                // can not revert
                revert("Spending limit exceeded");
            }
        }
        userSpendings[msg.sender][spender].push(
            Spending(
                balancesBeforeTxn[msg.sender] - balanceAfterTxn,
                block.timestamp
            )
        );
    }

    function calculateSpendingsForPeriod(
        address smartAccount,
        address _spender
    ) public view returns (uint256) {
        uint256 totalSpending = 0;
        for (
            uint256 i = 0;
            i < userSpendings[smartAccount][_spender].length;
            i++
        ) {
            if (
                block.timestamp -
                    userSpendings[smartAccount][_spender][i].timestamp <
                userLimits[smartAccount][_spender].period
            ) {
                totalSpending += userSpendings[smartAccount][_spender][i]
                    .amount;
            }
        }
        return totalSpending;
    }

    function setLimits(
        address _spender,
        uint256 _limitAmount,
        uint256 _period
    ) external {
        userLimits[msg.sender][_spender] = Limit(_limitAmount, _period);
    }

    function getLimits(
        address smartAccount,
        address _spender
    ) external view returns (uint256) {
        return userLimits[smartAccount][_spender].limitAmount;
    }
}
