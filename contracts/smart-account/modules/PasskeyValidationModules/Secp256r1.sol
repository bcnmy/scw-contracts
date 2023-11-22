// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;
//
// Initial Implementation by
// https://github.com/itsobvioustech/aa-passkeys-wallet/blob/main/src/Secp256r1.sol
// Heavily inspired from
// https://github.com/maxrobot/elliptic-solidity/blob/master/contracts/Secp256r1.sol
// https://github.com/tdrerup/elliptic-curve-solidity/blob/master/contracts/curves/EllipticCurve.sol
// modified to use precompile 0x05 modexp
// and modified jacobian double
// optimisations to avoid to an from from affine and jacobian coordinates
//
struct PassKeyId {
    uint256 pubKeyX;
    uint256 pubKeyY;
    string keyId;
}

struct JPoint {
    uint256 x;
    uint256 y;
    uint256 z;
}

library Secp256r1 {
    uint256 private constant GX =
        0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296;
    uint256 private constant GY =
        0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5;
    uint256 private constant PP =
        0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF;

    uint256 private constant NN =
        0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 private constant A =
        0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC;
    uint256 private constant B =
        0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B;
    uint256 private constant MOST_SIGNIFICANT =
        0xc000000000000000000000000000000000000000000000000000000000000000;

    /*
     * verify
     * @description - verifies that a public key has signed a given message
     * @param X - public key coordinate X
     * @param Y - public key coordinate Y
     * @param R - signature half R
     * @param S - signature half S
     * @param input - hashed message
     */
    function verify(
        PassKeyId memory passKey,
        uint256 r,
        uint256 s,
        uint256 e
    ) internal view returns (bool) {
        if (r == 0 || s == 0 || r >= NN || s >= NN) {
            return false;
        }
        // Verify that the public key is not the point at infinity and lies on the secp256r1 curve.
        if (!isValidPublicKey(passKey.pubKeyX, passKey.pubKeyY)) {
            return false;
        }

        JPoint[16] memory points = preComputeJacobianPoints(passKey);
        return verifyWithPrecompute(points, r, s, e);
    }

    function verifyWithPrecompute(
        JPoint[16] memory points,
        uint256 r,
        uint256 s,
        uint256 e
    ) internal view returns (bool) {
        uint256 w = primemod(s, NN);

        uint256 u1 = mulmod(e, w, NN);
        uint256 u2 = mulmod(r, w, NN);

        uint256 x;
        uint256 y;

        (x, y) = shamirMultJacobian(points, u1, u2);
        return ((x % NN) == r);
    }

    /*
     * Strauss Shamir trick for EC multiplication
     * https://stackoverflow.com/questions/50993471/ec-scalar-multiplication-with-strauss-shamir-method
     * we optimise on this a bit to do with 2 bits at a time rather than a single bit
     * the individual points for a single pass are precomputed
     * overall this reduces the number of additions while keeping the same number of doublings
     */
    function shamirMultJacobian(
        JPoint[16] memory points,
        uint256 u1,
        uint256 u2
    ) internal view returns (uint256, uint256) {
        uint256 x = 1;
        uint256 y = 1;
        uint256 z = 0;
        uint256 bits = 128;
        uint256 index = 0;

        while (bits > 0) {
            if (z > 0) {
                (x, y, z) = modifiedJacobianDouble(x, y, z);
                (x, y, z) = modifiedJacobianDouble(x, y, z);
            }
            index =
                ((u1 & MOST_SIGNIFICANT) >> 252) |
                ((u2 & MOST_SIGNIFICANT) >> 254);
            if (index > 0) {
                (x, y, z) = jAdd(
                    x,
                    y,
                    z,
                    points[index].x,
                    points[index].y,
                    points[index].z
                );
            }
            u1 <<= 2;
            u2 <<= 2;
            bits--;
        }
        (x, y) = affineFromJacobian(x, y, z);
        return (x, y);
    }

    /**
     * @notice Returns affine coordinates from a jacobian input. Follows the golang elliptic/crypto library convention.
     */
    function affineFromJacobian(
        uint256 x,
        uint256 y,
        uint256 z
    ) internal view returns (uint256 ax, uint256 ay) {
        if (z == 0) {
            return (0, 0);
        }

        uint256 zinv = primemod(z, PP);
        uint256 zinvsq = mulmod(zinv, zinv, PP);

        ax = mulmod(x, zinvsq, PP);
        ay = mulmod(y, mulmod(zinvsq, zinv, PP), PP);
    }

    /**
     * @notice Computes a^(-1) mod p using Fermat's Little Theorem
     * https://en.wikipedia.org/wiki/Fermat%27s_little_theorem
     * - a^(p-1) = 1 mod p
     * - a^(-1) ≅ a^(p-2) (mod p)
     * Uses the precompiled bigModExp to compute a^(-1).
     */
    function primemod(
        uint256 value,
        uint256 p
    ) internal view returns (uint256 ret) {
        ret = modexp(value, p - 2, p);
        return ret;
    }

    /**
     * @notice Wrapper function for built-in BigNumber_modexp (contract 0x5) as described here:
     * - https://github.com/ethereum/EIPs/pull/198
     */
    function modexp(
        uint256 _base,
        uint256 _exp,
        uint256 _mod
    ) internal view returns (uint256 ret) {
        // bigModExp(_base, _exp, _mod);
        assembly {
            if gt(_base, _mod) {
                _base := mod(_base, _mod)
            }
            // Free memory pointer is always stored at 0x40
            let freemem := mload(0x40)

            mstore(freemem, 0x20)
            mstore(add(freemem, 0x20), 0x20)
            mstore(add(freemem, 0x40), 0x20)

            mstore(add(freemem, 0x60), _base)
            mstore(add(freemem, 0x80), _exp)
            mstore(add(freemem, 0xa0), _mod)

            let success := staticcall(not(0), 0x5, freemem, 0xc0, freemem, 0x20)
            switch success
            case 0 {
                revert(0x0, 0x0)
            }
            default {
                ret := mload(freemem)
            }
        }
    }

    function isValidPublicKey(
        uint256 x,
        uint256 y
    ) internal pure returns (bool) {
        if (x >= PP || y >= PP) {
            return false; // (x, y) coordinates should satisfy, 0 <= x,y < p
        }
        uint256 lhs = mulmod(y, y, PP); // y^2 mod p
        uint256 rhs = addmod(
            mulmod(addmod(mulmod(x, x, PP), A, PP), x, PP),
            B,
            PP
        ); // (((x^2 + A) * x) + B) mod p https://en.wikipedia.org/wiki/Horner%27s_method

        return lhs == rhs; // y^2 = x^3 + ax + b (mod p)
    }

    function preComputeJacobianPoints(
        PassKeyId memory passKey
    ) internal pure returns (JPoint[16] memory points) {
        // JPoint[] memory u1Points = new JPoint[](4);
        // u1Points[0] = JPoint(1, 1, 0); // point of infinity in jacobian coordinates
        // u1Points[1] = JPoint(GX, GY, 1); // u1
        // u1Points[2] = jPointDouble(u1Points[1]);
        // u1Points[3] = jPointAdd(u1Points[1], u1Points[2]);
        // avoiding this intermediate step by using it in a single array below
        // these are pre computed points for u1

        // JPoint[16] memory points;
        points[0] = JPoint(1, 1, 0);
        points[1] = JPoint(passKey.pubKeyX, passKey.pubKeyY, 1); // u2
        points[2] = jPointDouble(points[1]);
        points[3] = jPointAdd(points[1], points[2]);

        points[4] = JPoint(GX, GY, 1); // u1Points[1]
        points[5] = jPointAdd(points[4], points[1]);
        points[6] = jPointAdd(points[4], points[2]);
        points[7] = jPointAdd(points[4], points[3]);

        points[8] = jPointDouble(points[4]); // u1Points[2]
        points[9] = jPointAdd(points[8], points[1]);
        points[10] = jPointAdd(points[8], points[2]);
        points[11] = jPointAdd(points[8], points[3]);

        points[12] = jPointAdd(points[4], points[8]); // u1Points[3]
        points[13] = jPointAdd(points[12], points[1]);
        points[14] = jPointAdd(points[12], points[2]);
        points[15] = jPointAdd(points[12], points[3]);
    }

    function jPointAdd(
        JPoint memory p1,
        JPoint memory p2
    ) internal pure returns (JPoint memory) {
        uint256 x;
        uint256 y;
        uint256 z;
        (x, y, z) = jAdd(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        return JPoint(x, y, z);
    }

    function jPointDouble(
        JPoint memory p
    ) internal pure returns (JPoint memory) {
        uint256 x;
        uint256 y;
        uint256 z;
        (x, y, z) = modifiedJacobianDouble(p.x, p.y, p.z);
        return JPoint(x, y, z);
    }

    /*
     * jAdd
     * @description performs double Jacobian as defined below:
     * https://hyperelliptic.org/EFD/g1p/auto-shortw-jacobian.html#addition-add-1998-cmo-2
     */
    function jAdd(
        uint256 p1,
        uint256 p2,
        uint256 p3,
        uint256 q1,
        uint256 q2,
        uint256 q3
    ) internal pure returns (uint256 r1, uint256 r2, uint256 r3) {
        if (p3 == 0) {
            return (q1, q2, q3);
        } else if (q3 == 0) {
            return (p1, p2, p3);
        }

        uint256 u1;
        uint256 u2;
        uint256 s1;
        uint256 s2;
        assembly {
            let
                pd
            := 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
            let z1z1 := mulmod(p3, p3, pd) // Z1Z1 = Z1^2
            let z2z2 := mulmod(q3, q3, pd) // Z2Z2 = Z2^2

            u1 := mulmod(p1, z2z2, pd) // U1 = X1*Z2Z2
            u2 := mulmod(q1, z1z1, pd) // U2 = X2*Z1Z1

            s1 := mulmod(p2, mulmod(z2z2, q3, pd), pd) // S1 = Y1*Z2*Z2Z2
            s2 := mulmod(q2, mulmod(z1z1, p3, pd), pd) // S2 = Y2*Z1*Z1Z1

            if lt(u2, u1) {
                u2 := add(pd, u2) // u2 = u2+pd
            }
            let h := sub(u2, u1) // H = U2-U1

            let i := mulmod(h, h, pd) // I = H^2

            let j := mulmod(h, i, pd) // J = H^3
            if lt(s2, s1) {
                s2 := add(pd, s2) // u2 = u2+pd
            }
            let rr := sub(s2, s1) // R = (S2-S1)
            r1 := mulmod(rr, rr, pd) // r1 = R^2

            let v := mulmod(u1, i, pd) // V = U1*I = U1*H^2
            let j2v := addmod(j, mulmod(0x02, v, pd), pd) // j2v = H^3 + 2*U1*H^2

            if lt(r1, j2v) {
                r1 := add(pd, r1) // X3 = X3+pd
            }
            r1 := sub(r1, j2v)

            let s12j := mulmod(s1, j, pd) // s12j = S1*H^3

            if lt(v, r1) {
                v := add(pd, v)
            }
            r2 := mulmod(rr, sub(v, r1), pd) // (U1*H^2 - r1)*R

            if lt(r2, s12j) {
                r2 := add(pd, r2)
            }
            r2 := sub(r2, s12j)

            r3 := mulmod(mulmod(p3, q3, pd), h, pd)
        }
        if ((u1 == u2) && (s1 == s2)) {
            (r1, r2, r3) = modifiedJacobianDouble(p1, p2, p3);
            return (r1, r2, r3);
        }
        return (r1, r2, r3);
    }

    // Point doubling on the modified jacobian coordinates
    // http://point-at-infinity.org/ecc/Prime_Curve_Modified_Jacobian_Coordinates.html
    function modifiedJacobianDouble(
        uint256 x,
        uint256 y,
        uint256 z
    ) internal pure returns (uint256 x3, uint256 y3, uint256 z3) {
        assembly {
            let
                pd
            := 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
            let z2 := mulmod(z, z, pd)
            let az4 := mulmod(
                0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC,
                mulmod(z2, z2, pd),
                pd
            )
            let y2 := mulmod(y, y, pd)
            let s := mulmod(0x04, mulmod(x, y2, pd), pd)
            let u := mulmod(0x08, mulmod(y2, y2, pd), pd)
            let m := addmod(mulmod(0x03, mulmod(x, x, pd), pd), az4, pd)
            let twos := mulmod(0x02, s, pd)
            let m2 := mulmod(m, m, pd)
            if lt(m2, twos) {
                m2 := add(pd, m2)
            }
            x3 := sub(m2, twos)
            if lt(s, x3) {
                s := add(pd, s)
            }
            y3 := mulmod(m, sub(s, x3), pd)
            if lt(y3, u) {
                y3 := add(pd, y3)
            }
            y3 := sub(y3, u)
            z3 := mulmod(0x02, mulmod(y, z, pd), pd)
        }
    }
}
