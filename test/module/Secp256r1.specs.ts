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

  it("Point addition P + Q where P is (1, 1, 0)", async () => {
    const p1X = BigNumber.from("1"); // P is the point at infinity
    const p1Y = BigNumber.from("1");
    const p1Z = BigNumber.from("0");
    const p2X = BigNumber.from("5"); // any point Q
    const p2Y = BigNumber.from("5");
    const p2Z = BigNumber.from("5");

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

  it("Point addition P + Q where Q is (1, 1, 0)", async () => {
    const p1X = BigNumber.from("5"); // P is any point
    const p1Y = BigNumber.from("5");
    const p1Z = BigNumber.from("5");
    const p2X = BigNumber.from("1"); // Q is the point at infinity
    const p2Y = BigNumber.from("1");
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
    const pX = 1; // P is the point at infinity
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
    const pX = 5; // any point on curve if same
    const pY = 1;
    const pZ = 5;

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

  // TODO: Add test for point addition where P is equal to -Q
  it("Point addition P + Q where P is equal to -Q", async () => {
    const px = 1;
  });

  it("Test Point from valid curve values", async () => {
    const p1X = BigNumber.from(
      "102403071235386942129802073633927364745593163841562425802125223486053883419147"
    ); // P is any point
    const p1Y = BigNumber.from(
      "57238631025539521861381823980215707206878884343005932892622792653151203351216"
    );
    const p1Z = BigNumber.from(
      "57238631025539521861381823980215707206878884343005932892622792653151203351216"
    );
    const p2X = BigNumber.from(
      "48439561293906451759052585252797914202762949526041747995844080717082404635286"
    ); // Q is any point
    const p2Y = BigNumber.from(
      "36134250956749795798585127919587881956611106672985015071877198253568414405109"
    );
    const p2Z = BigNumber.from("1");

    const [resultX, resultY, resultZ] = await secp256r1.jAdd(
      p1X,
      p1Y,
      p1Z,
      p2X,
      p2Y,
      p2Z
    );
    expect(
      BigNumber.from(resultX).eq(
        "7027020423653180680681697977574155747173625120349278496935681089261925327030"
      )
    );
    expect(BigNumber.from(resultY)).to.equal(
      "62425419119494428131315245342961114824928671318225902107220413968463822604674"
    );
    expect(BigNumber.from(resultZ)).to.equal(
      "82044049783345747209040034123170347486191278889119444798036024344518197942547"
    );
  });
});
