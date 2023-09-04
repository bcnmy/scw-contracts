import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { encodeTransfer } from "../../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import { fillAndSign, makeEcdsaModuleUserOp } from "../../utils/userOp";

describe("Upgrade v1 to Modular (v2) (ex. Ownerless)", async () => {
  const [deployer, smartAccountOwner, alice, charlie, verifiedSigner] =
    waffle.provider.getWallets();

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
      },
      smartAccountOwner,
      entryPoint,
      "nonce",
      false
    );

    const handleOpsTxn = await entryPoint.handleOps(
      [userOp],
      await alice.getAddress()
    );
    await handleOpsTxn.wait();

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
      },
      smartAccountOwner,
      entryPoint,
      "nonce",
      false
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
    await handleOpsTxn.wait();

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

  it("Can receive tokens to Modular Smart Account", async () => {
    const { userSAModular, mockToken } = await setupTestsAndUpgrade();

    const nativeBalanceBefore = await ethers.provider.getBalance(
      userSAModular.address
    );
    const tokenBalanceBefore = await mockToken.balanceOf(userSAModular.address);

    await deployer.sendTransaction({
      to: userSAModular.address,
      value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(
      userSAModular.address,
      ethers.utils.parseEther("1000000")
    );

    const expectedNativeBalanceAfter = nativeBalanceBefore.add(
      ethers.utils.parseEther("10")
    );
    const expectedTokenBalanceAfter = tokenBalanceBefore.add(
      ethers.utils.parseEther("1000000")
    );

    expect(await ethers.provider.getBalance(userSAModular.address)).to.equal(
      expectedNativeBalanceAfter
    );
    expect(await mockToken.balanceOf(userSAModular.address)).to.equal(
      expectedTokenBalanceAfter
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
      ecdsaModule.address
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
    await handleOpsTxn.wait();

    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });
});
