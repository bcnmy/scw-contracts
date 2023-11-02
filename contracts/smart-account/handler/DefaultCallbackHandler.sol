// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.19;

/* solhint-disable no-empty-blocks */

import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC777Recipient} from "@openzeppelin/contracts/token/ERC777/IERC777Recipient.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/** @title Default Callback Handler - returns true for known token callbacks
 *   @dev Handles EIP-1271 compliant isValidSignature requests.
 *  @notice inspired by Richard Meissner's <richard@gnosis.pm> implementation
 */
contract DefaultCallbackHandler is
    IERC165,
    IERC1155Receiver,
    IERC777Recipient,
    IERC721Receiver
{
    string public constant NAME = "Default Callback Handler";
    string public constant VERSION = "1.0.0";

    error NonExistingMethodCalled(bytes4 selector);

    fallback() external {
        revert NonExistingMethodCalled(msg.sig);
    }

    /**
     * @dev Checks if the contract supports a given interface.
     * @param interfaceId The interface identifier, as specified in ERC-165.
     * @return True if the contract implements the given interface, false otherwise.
     */

    function supportsInterface(
        bytes4 interfaceId
    ) external view virtual override returns (bool) {
        return
            interfaceId == type(IERC1155Receiver).interfaceId ||
            interfaceId == type(IERC721Receiver).interfaceId ||
            interfaceId == type(IERC777Recipient).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    /**
     * @dev Handles the receipt of a single ERC1155 token type.
     * @return The interface selector for the called function.
     */
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    /**
     * @dev Handles the receipt of multiple ERC1155 token types.
     * @return The interface selector for the called function.
     */
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    /**
     * @dev Handles the receipt of an ERC721 token.
     * @return The interface selector for the called function.
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /**
     * @dev Handles the receipt of an ERC777 token.
     * This function does not have any specific logic as it's implemented for completeness.
     */
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
