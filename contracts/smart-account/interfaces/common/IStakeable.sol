// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.19;

/**
 * @title Stakeable Entity
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */
interface IStakeable {
    function addStake(
        address epAddress,
        uint32 unstakeDelaySec
    ) external payable;

    function unlockStake(address epAddress) external;

    function withdrawStake(
        address epAddress,
        address payable withdrawAddress
    ) external;
}
