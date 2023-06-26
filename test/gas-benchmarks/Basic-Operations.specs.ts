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
  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] =
    waffle.provider.getWallets();

  const setupTests = deployments.createFixture(
    async ({ deployments, getNamedAccounts }) => {
      await deployments.fixture();

      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );
      const SmartAccountFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );

      const mockToken = await getMockToken();

      const ecdsaModule = await getEcdsaOwnershipRegistryModule();

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );

      const smartAccountDeploymentIndex = 0;

      const factory = await getSmartAccountFactory();
      const expectedSmartAccountAddress =
        await factory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );

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
      // 196694

      const userSA = await ethers.getContractAt(
        "SmartAccount",
        expectedSmartAccountAddress
      );

      await deployer.sendTransaction({
        to: userSA.address,
        value: ethers.utils.parseEther("10"),
      });

      await deployer.sendTransaction({
        to: alice.address,
        value: ethers.utils.parseEther("10"),
      });

      await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));
      await mockToken.mint(charlie.address, ethers.utils.parseEther("1"));

      return {
        entryPoint: await getEntryPoint(),
        smartAccountImplementation: await getSmartAccountImplementation(),
        smartAccountFactory: await getSmartAccountFactory(),
        mockToken: mockToken,
        ecdsaModule: ecdsaModule,
        userSA: userSA,
        verifyingPaymaster: await getVerifyingPaymaster(
          deployer,
          verifiedSigner
        ),
      };
    }
  );

  it("Can deploy SA with default module", async () => {
    const { mockToken, ecdsaModule, userSA } = await setupTests();

    expect(await userSA.isModuleEnabled(ecdsaModule.address)).to.equal(true);
    expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
      smartAccountOwner.address
    );

    expect(await ethers.provider.getBalance(userSA.address)).to.equal(
      ethers.utils.parseEther("10")
    );
    expect(await mockToken.balanceOf(userSA.address)).to.equal(
      ethers.utils.parseEther("1000000")
    );
  });

  it("Can send a native token transfer userOp", async () => {
    const { entryPoint, mockToken, userSA, ecdsaModule } = await setupTests();

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
      "executeCall",
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
      "executeCall",
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
      [ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex]
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
      "executeCall",
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
    const aliceSA = await ethers.getContractAt(
      "SmartAccount",
      expectedSmartAccountAddress
    );
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

    const userOp = await makeEcdsaModuleUserOpWithPaymaster(
      "executeCall",
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
      verifiedSigner
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
