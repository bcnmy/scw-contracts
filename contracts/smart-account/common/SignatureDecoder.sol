// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

/// @title SignatureDecoder - Decodes signatures that a encoded as bytes
abstract contract SignatureDecoder {
    /// @dev divides bytes signature into `uint8 v, bytes32 r, bytes32 s`.
    /// @param signature concatenated rsv signatures
    function _signatureSplit(
        bytes memory signature
    ) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        // The signature format is a compact form of:
        //   {bytes32 r}{bytes32 s}{uint8 v}
        // Compact means, uint8 is not padded to 32 bytes.

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            // Here we are loading the last 32 bytes, including 31 bytes
            // of 's'. There is no 'mload8' to do this.
            //
            // 'byte' is not working due to the Solidity parser, so let's
            // use the second best option, 'and'
            v := and(mload(add(signature, 0x41)), 0xff)
        }
    }
}
