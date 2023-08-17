import { ethers, deployments } from "hardhat";
import {
  BundlerTestEnvironment,
  UserOperationSubmissionError,
} from "./bundlerEnvironment";
import { expect } from "chai";
import {
  getEcdsaOwnershipRegistryModule,
  getEntryPoint,
  getMockToken,
  getSmartAccountFactory,
  getSmartAccountImplementation,
  getSmartAccountWithModule,
} from "../../utils/setupHelper";
import {
  EcdsaOwnershipRegistryModule__factory,
  ForbiddenOpcodeInvokingAuthModule__factory,
} from "../../../typechain";
import { makeEcdsaModuleUserOp } from "../../utils/userOp";
import { encodeTransfer } from "../../utils/testUtils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Bundler Environment", async () => {
  let signers: SignerWithAddress[];
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    charlie: SignerWithAddress,
    smartAccountOwner: SignerWithAddress;
  let environment: BundlerTestEnvironment;

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
    };
  });

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async () => {
    signers = await ethers.getSigners();
    [deployer, alice, bob, charlie, smartAccountOwner] = signers;
  });

  afterEach(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    await Promise.all([
      environment.revert(environment.defaultSnapshot!),
      environment.resetBundler(),
    ]);
  });

  it("Default Signers should have funds after environment setup", async () => {
    for (const signer of signers) {
      expect(await ethers.provider.getBalance(signer.address)).to.be.gte(
        BundlerTestEnvironment.DEFAULT_FUNDING_AMOUNT
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
      "execute_ncC",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address,
      {
        preVerificationGas: 50000,
      }
    );

    await environment.sendUserOperation(userOp, entryPoint.address);

    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });

  const setupTestsWithRecusantValidationModule = deployments.createFixture(
    async ({ deployments }) => {
      await deployments.fixture();

      const mockToken = await getMockToken();

      const ecdsaModule = await new ForbiddenOpcodeInvokingAuthModule__factory(
        deployer
      ).deploy();
      const ecdsaOwnershipSetupData =
        ForbiddenOpcodeInvokingAuthModule__factory.createInterface().encodeFunctionData(
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
      };
    }
  );

  it("Should not submit user operation that calls TIMESTAMP in the validation phase", async () => {
    const { entryPoint, mockToken, userSA, ecdsaModule } =
      await setupTestsWithRecusantValidationModule();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const userOp = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address,
      {
        preVerificationGas: 50000,
      }
    );

    const expectedError = new UserOperationSubmissionError(
      '{"message":"account uses banned opcode: TIMESTAMP","code":-32502}'
    );
    let thrownError: Error | null = null;

    try {
      await environment.sendUserOperation(userOp, entryPoint.address);
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).to.deep.equal(expectedError);
  });

  it("Should not submit userOp which accesses not associated storage in the validation phase", async () => {
    const { entryPoint, mockToken, userSA, ecdsaModule } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.54245");

    const storageAccessViolatingEcdsaModule = await (
      await ethers.getContractFactory("WrongStorageAccessValidationModule")
    ).deploy();

    // enable and initiate the violating module
    const setupCalldata =
      storageAccessViolatingEcdsaModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await smartAccountOwner.getAddress()]
      );

    const userOp = await makeEcdsaModuleUserOp(
      "setupAndEnableModule",
      [storageAccessViolatingEcdsaModule.address, setupCalldata],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address,
      {
        preVerificationGas: 50000,
      }
    );
    await environment.sendUserOperation(userOp, entryPoint.address);

    const violatingUserOp = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      storageAccessViolatingEcdsaModule.address,
      {
        preVerificationGas: 50000,
      }
    );

    const expectedError = new UserOperationSubmissionError(
      '{"message":"account has forbidden read from'
    );
    let thrownError: Error | null = null;

    try {
      await environment.sendUserOperation(violatingUserOp, entryPoint.address);
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).to.contain(expectedError);
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore
    );
  });
});
