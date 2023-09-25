// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

/* solhint-disable no-empty-blocks */

import {IERC1155TokenReceiver} from "../interfaces/IERC1155TokenReceiver.sol";
import {IERC721TokenReceiver} from "../interfaces/IERC721TokenReceiver.sol";
import {IERC777TokensRecipient} from "../interfaces/IERC777TokensRecipient.sol";
import {IERC165} from "../interfaces/IERC165.sol";

/** @title Default Callback Handler - returns true for known token callbacks
 *   @dev Handles EIP-1271 compliant isValidSignature requests.
 *  @notice inspired by Richard Meissner's <richard@gnosis.pm> implementation
 */
contract DefaultCallbackHandler is
    IERC1155TokenReceiver,
    IERC777TokensRecipient,
    IERC721TokenReceiver,
    IERC165
{
    string public constant NAME = "Default Callback Handler";
    string public constant VERSION = "1.0.0";

    function supportsInterface(
        bytes4 interfaceId
    ) external view virtual override returns (bool) {
        return
            interfaceId == type(IERC1155TokenReceiver).interfaceId ||
            interfaceId == type(IERC721TokenReceiver).interfaceId ||
            interfaceId == type(IERC777TokensRecipient).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155TokenReceiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155TokenReceiver.onERC1155BatchReceived.selector;
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721TokenReceiver.onERC721Received.selector;
    }

    function tokensReceived(
        address,
        address,
        address,
        uint256,
        bytes calldata,
        bytes calldata
    ) external pure override {
        // We implement this for completeness, doesn't really have any value
    }
}
