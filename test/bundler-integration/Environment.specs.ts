import { ethers } from "hardhat";
import { BundlerTestEnvironment } from "./bundlerEnvironment";
import { expect } from "chai";

describe("Bundler Environment", async () => {
  const signers = await ethers.getSigners();
  const [alice, bob] = signers;
  let environment: BundlerTestEnvironment;

  before(async () => {
    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  it("Default Signers should have funds after environment setup", async () => {
    for (const signer of signers) {
      expect(await ethers.provider.getBalance(signer.address)).to.be.gte(
        environment.DEFAULT_FUNDING_AMOUNT
      );
    }
  });

  it("Should be able to revert to snapshot", async () => {
    const aliceBalance = await ethers.provider.getBalance(alice.address);
    const bobBalance = await ethers.provider.getBalance(bob.address);

    const snapshot = await environment.snapshot();

    await expect(
      alice.sendTransaction({
        to: bob.address,
        value: ethers.utils.parseEther("1"),
      })
    ).to.not.be.reverted;

    await environment.revert(snapshot);

    expect(await ethers.provider.getBalance(alice.address)).to.eq(aliceBalance);
    expect(await ethers.provider.getBalance(bob.address)).to.eq(bobBalance);
  });
});
