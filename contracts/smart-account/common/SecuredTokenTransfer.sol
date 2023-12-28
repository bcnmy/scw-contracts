// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.23;

/// @title SecuredTokenTransfer - Secure token transfer
abstract contract SecuredTokenTransfer {
    /**
     * @dev Transfers a specified amount of ERC20 tokens to a receiver.
     * @notice This function utilizes the standard `transfer` function of ERC20 tokens.
     * It ensures the token address is valid and that the token contract exists before attempting the transfer.
     * @param token The address of the ERC20 token to be transferred.
     * @param receiver The address to receive the tokens.
     * @param amount The amount of tokens to transfer.
     * @return transferred A boolean indicating whether the transfer was successful.
     */
    function _transferToken(
        address token,
        address receiver,
        uint256 amount
    ) internal returns (bool transferred) {
        require(token != address(0), "token can not be zero address");
        require(token.code.length > 0, "token contract doesn't exist");
        // 0xa9059cbb - keccack("transfer(address,uint256)")
        bytes memory data = abi.encodeWithSelector(
            0xa9059cbb,
            receiver,
            amount
        );

        assembly {
            // We write the return value to scratch space.
            // See https://docs.soliditylang.org/en/latest/internals/layout_in_memory.html#layout-in-memory
            let success := call(
                sub(gas(), 10000),
                token,
                0,
                add(data, 0x20),
                mload(data),
                0,
                0x20
            )
            switch returndatasize()
            case 0 {
                transferred := success
            }
            case 0x20 {
                transferred := iszero(or(iszero(success), iszero(mload(0))))
            }
            default {
                transferred := 0
            }
        }
    }
}
