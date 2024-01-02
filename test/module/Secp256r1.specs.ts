import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";

describe("Secp256r1 tests:", function () {
  let secp256r1: Contract;

  before(async () => {
    const secp256rInstance = await ethers.getContractFactory("TestSecp256r1");
    const secp256r1Deployment = await secp256rInstance.deploy();
    secp256r1 = secp256rInstance.attach(secp256r1Deployment.address);
  });

  it("Point addition P + Q where P is (0) -> (4, 8, 0)", async () => {
    const p1X = BigNumber.from("4"); // P as the point at infinity
    const p1Y = BigNumber.from("8");
    const p1Z = BigNumber.from("0");
    const p2X = BigNumber.from(
      "0x150c79a46d10a0a7b5977ce4b1e7f35dad727095655b33a38bfece87c66b5f07"
    ); // any point Q
    const p2Y = BigNumber.from(
      "0x7165fee1b0b7ff988cef7a9234527b89814cef0f95a4101ecbd98f1e84e086a9"
    );
    const p2Z = BigNumber.from(
      "0x67f4336965ac19295a42860c44f2724595138978380e171631046a570fb257d8"
    );

    const [resultX, resultY, resultZ] = await secp256r1.jAdd(
      p1X,
      p1Y,
      p1Z,
      p2X,
      p2Y,
      p2Z
    );

    // The result should be equal to Q since P is the point at infinity
    expect(resultX).to.equal(p2X);
    expect(resultY).to.equal(p2Y);
    expect(resultZ).to.equal(p2Z);
  });

  // px = c^2 * qx,py = c^3 * qy,andpz = c * qz
  it("Point addition P + Q where Q is (0) -> (4, 8, 0)", async () => {
    const p1X = BigNumber.from(
      "0x150c79a46d10a0a7b5977ce4b1e7f35dad727095655b33a38bfece87c66b5f07"
    ); // P is any point
    const p1Y = BigNumber.from(
      "0x7165fee1b0b7ff988cef7a9234527b89814cef0f95a4101ecbd98f1e84e086a9"
    );
    const p1Z = BigNumber.from(
      "0x67f4336965ac19295a42860c44f2724595138978380e171631046a570fb257d8"
    );
    const p2X = BigNumber.from("4"); // Q as the point at infinity
    const p2Y = BigNumber.from("8");
    const p2Z = BigNumber.from("0");

    const [resultX, resultY, resultZ] = await secp256r1.jAdd(
      p1X,
      p1Y,
      p1Z,
      p2X,
      p2Y,
      p2Z
    );

    // The result should be equal to P since Q is the point at infinity
    expect(resultX).to.equal(p1X);
    expect(resultY).to.equal(p1Y);
    expect(resultZ).to.equal(p1Z);
  });

  it("Point addition P + Q where P is equal to Q = point at infinity", async () => {
    const pX = 1; // P as the point at infinity same as Jacob cordinates point of infinity
    const pY = 1;
    const pZ = 0;

    // This would return the P (1, 1, 0)
    const [resultX, resultY, resultZ] = await secp256r1.jAdd(
      pX,
      pY,
      pZ,
      pX,
      pY,
      pZ
    );
    expect(resultX).to.equal(1);
    expect(resultY).to.equal(1);
    expect(resultZ).to.equal(0);
  });

  it("Point addition P + Q where P is equal to Q", async () => {
    const pX = BigNumber.from(
      "0x150c79a46d10a0a7b5977ce4b1e7f35dad727095655b33a38bfece87c66b5f07"
    );
    const pY = BigNumber.from(
      "0x7165fee1b0b7ff988cef7a9234527b89814cef0f95a4101ecbd98f1e84e086a9"
    );
    const pZ = BigNumber.from(
      "0x67f4336965ac19295a42860c44f2724595138978380e171631046a570fb257d8"
    );

    const [resultX, resultY, resultZ] = await secp256r1.jAdd(
      pX,
      pY,
      pZ,
      pX,
      pY,
      pZ
    );

    // The result should be equal to the result of point doubling P
    const [expectedX, expectedY, expectedZ] =
      await secp256r1.modifiedJacobianDouble(pX, pY, pZ);
    expect(resultX).to.equal(expectedX);
    expect(resultY).to.equal(expectedY);
    expect(resultZ).to.equal(expectedZ);
  });

  it("Point addition P + Q where P is equal to -Q", async () => {
    const p1X = BigNumber.from("5");
    const p1Y = BigNumber.from("5");
    const p1Z = BigNumber.from("5");
    const PP = BigNumber.from(
      "0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF"
    );

    // Perform the point addition which should result in the point at infinity
    // (c^2 mod p, c^3 mod p, 0) for some c > 0
    const [resultX, resultY, resultZ] = await secp256r1.jAdd(
      p1X,
      p1Y,
      p1Z,
      p1X,
      PP.sub(p1Y),
      p1Z
    );

    const c = resultY.div(resultX);

    expect(resultX.eq(c.pow(2))).to.equal(true);
    expect(resultY.eq(c.pow(3))).to.equal(true);
    expect(resultZ.eq(0)).to.equal(true);
  });

  it("Test valid point on curve for jAdd, jDouble and affineFromJacobian", async () => {
    const p1X = BigNumber.from(
      "0x150c79a46d10a0a7b5977ce4b1e7f35dad727095655b33a38bfece87c66b5f07"
    );
    const p1Y = BigNumber.from(
      "0x7165fee1b0b7ff988cef7a9234527b89814cef0f95a4101ecbd98f1e84e086a9"
    );
    const p1Z = BigNumber.from(
      "0x67f4336965ac19295a42860c44f2724595138978380e171631046a570fb257d8"
    );
    const [pAffine1X, pAffine1Y] = await secp256r1.affineFromJacobian(
      p1X,
      p1Y,
      p1Z
    );

    // Test the affine coordinates conversion
    expect(
      BigNumber.from(
        "0xb0b6840592ad97cd59edadb92373e7a7e1b49a2eb0030096438115ba1b3b61ae"
      ).eq(pAffine1X)
    ).to.equal(true);
    expect(
      BigNumber.from(
        "0xc6e581c825ecc3c412ae7246329ac3ba0735a1fb02000e6e1c1b215ea8681d19"
      ).eq(pAffine1Y)
    ).to.equal(true);

    const p2X = BigNumber.from(
      "0x2b418610e52cd1cef9d77e3f424cea5733d3a0ec2ad4afdce10afad73ee35dfd"
    );
    const p2Y = BigNumber.from(
      "0x1a78d5f068814dd8d69a28771774329f0c8b84d6cf60d0f909e1f7e25b2979fa"
    );
    const p2Z = BigNumber.from(
      "0x872aba6d3b28a2caa6d390408f733ac1087a4d7a3ebd5f32abf7edaa8c753042"
    );
    const [pAffine2X, pAffine2Y] = await secp256r1.affineFromJacobian(
      p2X,
      p2Y,
      p2Z
    );

    // Test the affine coordinates conversion
    expect(
      BigNumber.from(
        "0x6933b0ee884cd2f1a5c50855246d63d2b6957699c6c8e35ad3ecbbd60257c86c"
      ).eq(pAffine2X)
    ).to.equal(true);
    expect(
      BigNumber.from(
        "0x8684f8ed29e5a0d70b1d8e00e15dbea66451209592900098e40c27adac16064d"
      ).eq(pAffine2Y)
    ).to.equal(true);

    const [resultX, resultY, resultZ] = await secp256r1.jAdd(
      p1X,
      p1Y,
      p1Z,
      p2X,
      p2Y,
      p2Z
    );
    const [resultAffineX, resultAffineY] = await secp256r1.affineFromJacobian(
      resultX,
      resultY,
      resultZ
    );

    // Test the jacob Add and the affine coordinates conversion
    expect(
      BigNumber.from(
        "0x59ad9d1c7eb87b186a39d407b3d95f4a82558362d1f22c83341e65aaa04dfded"
      ).eq(resultAffineX)
    ).to.equal(true);
    expect(
      BigNumber.from(
        "0x50f755015574b0b972cc4c3e12a216adcb22eeddfd6d190e8c9deffe49cce3ef"
      ).eq(resultAffineY)
    ).to.equal(true);

    // Test the jacob double (for first point) and the affine coordinates conversion
    const [resultDoubleX, resultDoubleY, resultDoubleZ] =
      await secp256r1.modifiedJacobianDouble(p1X, p1Y, p1Z);
    const [resultDoubleAffineX, resultDoubleAffineY] =
      await secp256r1.affineFromJacobian(
        resultDoubleX,
        resultDoubleY,
        resultDoubleZ
      );

    expect(
      BigNumber.from(
        "0x2a7f7ad220dfc864cb904e329b3352316c6fc28cf957f9b49172eed935aa6b8c"
      ).eq(resultDoubleAffineX)
    ).to.equal(true);
    expect(
      BigNumber.from(
        "0xebab24f82736e63c11576f8a969f566c0daff09c63e444337acbe20103695a8f"
      ).eq(resultDoubleAffineY)
    ).to.equal(true);
  });
});
