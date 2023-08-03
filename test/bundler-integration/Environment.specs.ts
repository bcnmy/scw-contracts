import { ethers, deployments } from "hardhat";
import { BundlerTestEnvironment, Snapshot } from "./bundlerEnvironment";
import { expect } from "chai";
import {
  getEcdsaOwnershipRegistryModule,
  getEntryPoint,
  getMockToken,
  getSmartAccountFactory,
  getSmartAccountImplementation,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import { EcdsaOwnershipRegistryModule__factory } from "../../typechain";
import { makeEcdsaModuleUserOp } from "../utils/userOp";
import { encodeTransfer } from "../utils/testUtils";

describe("Bundler Environment", async () => {
  const signers = await ethers.getSigners();
  const [deployer, alice, bob, charlie, smartAccountOwner, verifiedSigner] =
    signers;
  let environment: BundlerTestEnvironment;
  let defaultSnapshot: Snapshot;

  before(async () => {
    environment = await BundlerTestEnvironment.getDefaultInstance();
    defaultSnapshot = await environment.snapshot();
  });

  afterEach(async () => {
    await environment.revert(defaultSnapshot);
  });

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const mockToken = await getMockToken();

    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const ecdsaOwnershipSetupData =
      EcdsaOwnershipRegistryModule__factory.createInterface().encodeFunctionData(
        "initForSmartAccount",
        [await smartAccountOwner.getAddress()]
      );

    const smartAccountDeploymentIndex = 0;

    const userSA = await getSmartAccountWithModule(
      ecdsaModule.address,
      ecdsaOwnershipSetupData,
      smartAccountDeploymentIndex
    );

    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    const entryPoint = await getEntryPoint();

    return {
      entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  it("Default Signers should have funds after environment setup", async () => {
    for (const signer of signers) {
      expect(await ethers.provider.getBalance(signer.address)).to.be.gte(
        environment.DEFAULT_FUNDING_AMOUNT
      );
    }
  });

  it("Should be able to revert to snapshot", async () => {
    await setupTests();

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

  it("Should be able to submit user operation using bundler", async () => {
    const { entryPoint, mockToken, userSA, ecdsaModule } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const userOp = await makeEcdsaModuleUserOp(
      "executeCall",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
    await handleOpsTxn.wait();

    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });
});
