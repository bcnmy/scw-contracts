// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IStatefulSessionKeyManagerBase} from "./IStatefulSessionKeyManagerBase.sol";

/* solhint-disable no-empty-blocks*/

/**
 * @title Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev Similar to the Stateful Session Key Manager module, but the session enable transaction
 *      is batched with the first transaction that uses the session key.
 *      Session creation is offline and completely free.
 * @author Ankur Dubey - <ankur@biconomy.io>
 */
interface ISessionKeyManagerModuleHybrid is IStatefulSessionKeyManagerBase {

}
