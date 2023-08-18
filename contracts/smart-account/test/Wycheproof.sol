// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.17;
import {Secp256r1, PassKeyId} from "../modules/PasskeyValidationModules/Secp256r1.sol";

contract Wycheproof {
    function verifyStatic(
        PassKeyId memory passKey,
        uint r,
        uint s,
        uint e
    ) external view returns (bool) {
        return Secp256r1.Verify(passKey, r, s, e);
    }
}
