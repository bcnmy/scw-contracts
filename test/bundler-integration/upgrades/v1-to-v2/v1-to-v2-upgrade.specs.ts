import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { encodeTransfer } from "../../../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../../utils/setupHelper";
import { fillAndSign, makeEcdsaModuleUserOp } from "../../../utils/userOp";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BundlerTestEnvironment } from "../../environment/bundlerEnvironment";

describe("Upgrade v1 to Modular (v2) (ex. Ownerless) (with Bundler)", async () => {
  let [deployer, smartAccountOwner, charlie, verifiedSigner] =
    [] as SignerWithAddress[];

  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [deployer, smartAccountOwner, charlie, verifiedSigner] =
      await ethers.getSigners();
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

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const entryPoint = await getEntryPoint();

    const mockToken = await getMockToken();

    const BaseImplementationV1 = await ethers.getContractFactory(
      "SmartAccountV1"
    );
    const baseImplV1 = await BaseImplementationV1.deploy(entryPoint.address);
    await baseImplV1.deployed();

    const WalletFactoryV1 = await ethers.getContractFactory(
      "SmartAccountFactoryV1"
    );
    const walletFactoryV1 = await WalletFactoryV1.deploy(baseImplV1.address);
    await walletFactoryV1.deployed();

    const expectedSmartAccountAddress =
      await walletFactoryV1.getAddressForCounterFactualAccount(
        smartAccountOwner.address,
        0
      );

    await walletFactoryV1.deployCounterFactualAccount(
      smartAccountOwner.address,
      0
    );

    const userSAV1 = await ethers.getContractAt(
      "contracts/smart-account/test/upgrades/v1/SmartAccountV1.sol:SmartAccountV1",
      expectedSmartAccountAddress
    );

    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
      "EcdsaOwnershipRegistryModule"
    );

    const ecdsaOwnershipSetupData =
      EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
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
      to: userSAV1.address,
      value: ethers.utils.parseEther("10"),
    });

    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(userSAV1.address, ethers.utils.parseEther("1000000"));
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      userSAV1: userSAV1,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  const setupTestsAndUpgrade = async () => {
    const {
      entryPoint,
      smartAccountImplementation,
      smartAccountFactory,
      mockToken,
      ecdsaModule,
      userSAV1,
      verifyingPaymaster,
    } = await setupTests();

    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
      "EcdsaOwnershipRegistryModule"
    );
    const SmartAccountV1 = await ethers.getContractFactory("SmartAccountV1");
    const SmartAccountModular = await ethers.getContractFactory("SmartAccount");

    const updateImplCallData = SmartAccountV1.interface.encodeFunctionData(
      "updateImplementation",
      [smartAccountImplementation.address]
    );

    const ecdsaOwnershipSetupData =
      EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [smartAccountOwner.address]
      );

    const setupAndEnableModuleCallData =
      SmartAccountModular.interface.encodeFunctionData("setupAndEnableModule", [
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
      ]);

    const userSAModular = await ethers.getContractAt(
      "SmartAccount",
      userSAV1.address
    );

    // UserOp calldata
    const userOpExecuteBatchCallData =
      SmartAccountV1.interface.encodeFunctionData("executeBatchCall", [
        [userSAV1.address, userSAModular.address],
        [ethers.utils.parseEther("0"), ethers.utils.parseEther("0")],
        [updateImplCallData, setupAndEnableModuleCallData],
      ]);

    const userOp = await fillAndSign(
      {
        sender: userSAV1.address,
        callData: userOpExecuteBatchCallData,
        callGasLimit: 1_000_000,
        preVerificationGas: 50000,
      },
      smartAccountOwner,
      entryPoint,
      "nonce",
      false
    );

    await environment.sendUserOperation(userOp, entryPoint.address);

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: smartAccountImplementation,
      smartAccountFactory: smartAccountFactory,
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSAModular: userSAModular,
      verifyingPaymaster: verifyingPaymaster,
    };
  };

  it("Can send userOp via Smart Account V1", async () => {
    const { entryPoint, mockToken, userSAV1 } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const SmartAccountV1 = await ethers.getContractFactory("SmartAccountV1");

    const txnData = SmartAccountV1.interface.encodeFunctionData("executeCall", [
      mockToken.address,
      ethers.utils.parseEther("0"),
      encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
    ]);

    const userOp = await fillAndSign(
      {
        sender: userSAV1.address,
        callData: txnData,
        verificationGasLimit: 200000,
        preVerificationGas: 50000,
      },
      smartAccountOwner,
      entryPoint,
      "nonce",
      false
    );

    await environment.sendUserOperation(userOp, entryPoint.address);

    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });

  it("Can upgrade v1 to Modular, owner info moved to module", async () => {
    const { ecdsaModule, userSAModular } = await setupTestsAndUpgrade();

    expect(await userSAModular.isModuleEnabled(ecdsaModule.address)).to.equal(
      true
    );
    expect(await ecdsaModule.getOwner(userSAModular.address)).to.equal(
      smartAccountOwner.address
    );
  });

  it("Can send userOp via Modular Smart Account", async () => {
    const { entryPoint, mockToken, userSAModular, ecdsaModule } =
      await setupTestsAndUpgrade();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.6326");

    const userOp = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSAModular.address,
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
});
