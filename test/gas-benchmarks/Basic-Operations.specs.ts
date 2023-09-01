import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { encodeTransfer } from "../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import {
  makeEcdsaModuleUserOp,
  makeEcdsaModuleUserOpWithPaymaster,
  fillAndSign,
} from "../utils/userOp";

describe("Gas Benchmarking. Basic operations", async () => {
  const [deployer, smartAccountOwner, alice, charlie, verifiedSigner] =
    waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
      "EcdsaOwnershipRegistryModule"
    );
    const SmartAccountFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );

    const mockToken = await getMockToken();

    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const smartAccountFactory = await getSmartAccountFactory();
    const entryPoint = await getEntryPoint();

    const ecdsaOwnershipSetupData =
      EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await smartAccountOwner.getAddress()]
      );

    const smartAccountDeploymentIndex = 0;

    const factory = await getSmartAccountFactory();

    const deploySATx = await factory.deployCounterFactualAccount(
      ecdsaModule.address,
      ecdsaOwnershipSetupData,
      smartAccountDeploymentIndex
    );
    const receipt = await deploySATx.wait();
    console.log(
      "Gas used to directly deploy SA: ",
      receipt.cumulativeGasUsed.toString()
    );

    // ===============  deply SA via userOp =================

    const deploymentData = SmartAccountFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex + 1,
      ]
    );

    const expectedSmartAccountAddress2 =
      await smartAccountFactory.getAddressForCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex + 1
      );

    // funding account
    await deployer.sendTransaction({
      to: expectedSmartAccountAddress2,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(
      expectedSmartAccountAddress2,
      ethers.utils.parseEther("1000000")
    );

    // deployment userOp
    const deploymentUserOp = await fillAndSign(
      {
        sender: expectedSmartAccountAddress2,
        callGasLimit: 1_000_000,
        initCode: ethers.utils.hexConcat([
          smartAccountFactory.address,
          deploymentData,
        ]),
        callData: "0x",
      },
      smartAccountOwner,
      entryPoint,
      "nonce"
    );

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [deploymentUserOp.signature, ecdsaModule.address]
    );

    deploymentUserOp.signature = signatureWithModuleAddress;

    const handleOpsTxn = await entryPoint.handleOps(
      [deploymentUserOp],
      alice.address,
      { gasLimit: 10000000 }
    );
    const receipt2 = await handleOpsTxn.wait();
    console.log(
      "Deploy with an ecdsa signature via userOp gas used: ",
      receipt2.gasUsed.toString()
    );
    // this moves nonce from 0 to further tests using userSA

    const userSA = await ethers.getContractAt(
      "SmartAccount",
      expectedSmartAccountAddress2
    );

    // ===== rest of setup ====

    await deployer.sendTransaction({
      to: alice.address,
      value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(charlie.address, ethers.utils.parseEther("1"));

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: smartAccountFactory,
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  it("Can deploy SA with default module", async () => {
    const { mockToken, ecdsaModule, userSA } = await setupTests();

    expect(await userSA.isModuleEnabled(ecdsaModule.address)).to.equal(true);
    expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
      smartAccountOwner.address
    );

    expect(await ethers.provider.getBalance(userSA.address)).to.be.above(
      ethers.utils.parseEther("9") // gas was used for first userOp
    );
    expect(await mockToken.balanceOf(userSA.address)).to.equal(
      ethers.utils.parseEther("1000000")
    );
  });

  it("Can send a native token transfer userOp", async () => {
    const { entryPoint, userSA, ecdsaModule } = await setupTests();

    const tx = await deployer.sendTransaction({
      from: deployer.address,
      to: charlie.address,
      value: ethers.utils.parseEther("5"),
    });
    await tx.wait();

    const charlieTokenBalanceBefore = await charlie.getBalance();
    console.log(
      "Charlie balance before: ",
      charlieTokenBalanceBefore.toString()
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const userOp = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [charlie.address, tokenAmountToTransfer, "0x"],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
    const receipt = await handleOpsTxn.wait();
    console.log("Native token transfer gas used: ", receipt.gasUsed.toString());

    expect(await charlie.getBalance()).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });

  it("Can send a erc20 token transfer userOp", async () => {
    const { entryPoint, mockToken, userSA, ecdsaModule } = await setupTests();

    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    console.log(
      "Charlie balance before: ",
      charlieTokenBalanceBefore.toString()
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("10");

    const userOp = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [
        mockToken.address,
        "0",
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
    const receipt = await handleOpsTxn.wait();
    console.log("ERC20 token transfer gas used: ", receipt.gasUsed.toString());

    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });

  it("Can deploy account and send a native token transfer userOp", async () => {
    const { entryPoint, smartAccountFactory, ecdsaModule } = await setupTests();

    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
      "EcdsaOwnershipRegistryModule"
    );
    const SmartAccountFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const charlieTokenBalanceBefore = await charlie.getBalance();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const ecdsaOwnershipSetupData =
      EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await alice.getAddress()]
      );

    const smartAccountDeploymentIndex = 0;

    const deploymentData = SmartAccountFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex,
      ]
    );

    const expectedSmartAccountAddress =
      await smartAccountFactory.getAddressForCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("10"),
    });

    const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
      "execute_ncC",
      [charlie.address, tokenAmountToTransfer, "0x"]
    );

    const userOp = await fillAndSign(
      {
        sender: expectedSmartAccountAddress,
        callGasLimit: 1_000_000,
        initCode: ethers.utils.hexConcat([
          smartAccountFactory.address,
          deploymentData,
        ]),
        callData: txnDataAA1,
      },
      alice,
      entryPoint,
      "nonce"
    );

    // add validator module address to the signature
    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [userOp.signature, ecdsaModule.address]
    );

    userOp.signature = signatureWithModuleAddress;

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address, {
      gasLimit: 10000000,
    });
    const receipt = await handleOpsTxn.wait();
    console.log(
      "Deploy + token transfer userop gas used: ",
      receipt.gasUsed.toString()
    );

    expect(await charlie.getBalance()).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });

  it("Can send a userOp with Paymaster payment", async () => {
    const { entryPoint, mockToken, userSA, ecdsaModule, verifyingPaymaster } =
      await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.6458");

    const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
    const validUntil = blockTimestamp + 1000;
    const validAfter = blockTimestamp;

    const userOp = await makeEcdsaModuleUserOpWithPaymaster(
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
      verifyingPaymaster,
      verifiedSigner,
      validUntil,
      validAfter
    );

    const handleOpsTxn = await entryPoint.handleOps(
      [userOp],
      verifiedSigner.address
    );
    const receipt = await handleOpsTxn.wait();
    console.log(
      "UserOp ERC20 Token transfer with Paymaster gas used: ",
      receipt.gasUsed.toString()
    );

    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });
});
