import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { encodeTransfer } from "../utils/testUtils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import { makeEcdsaModuleUserOp, makeEcdsaModuleUserOpWithPaymaster, fillAndSign } from "../utils/userOp";

describe("UserOps", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner, notEnabledModule] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    await deployments.fixture();

    const mockToken = await getMockToken();
    
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory("EcdsaOwnershipRegistryModule");
      
    let ecdsaOwnershipSetupData = EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );

    const smartAccountDeploymentIndex = 0;

    const userSA = await getSmartAccountWithModule(ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex);

    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));
    
    return {
      entryPoint: await getEntryPoint(),
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  describe("validateUserOp ", async () => {

    it ("Can validate a userOp via proper Authorization Module", async () => {
      const { 
        entryPoint, 
        mockToken,
        userSA,
        ecdsaModule
      } = await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
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
      )

      const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
      await handleOpsTxn.wait();

      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
    });

    it ("Reverts when trying to forward validateUserOp flow to the enabled module that doesnt implement proper interface", async () => {
      const { 
        entryPoint, 
        mockToken,
        userSA,
        ecdsaModule
      } = await setupTests();

      const MockInvalidAuthModule = await ethers.getContractFactory("MockInvalidAuthModule");
      const mockInvalidAuthModule = await MockInvalidAuthModule.deploy();

      const userOpEnableModule = await makeEcdsaModuleUserOp(
        "enableModule",
        [
          mockInvalidAuthModule.address
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      )
      await entryPoint.handleOps([userOpEnableModule], alice.address);
      expect(await userSA.isModuleEnabled(mockInvalidAuthModule.address)).to.be.true;

      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ]
      );
      const userOp = await fillAndSign(
        {
          sender: userSA.address,
          callData: txnDataAA1
        },
        smartAccountOwner,
        entryPoint,
        'nonce'
      );
      // add invalid validator module address to the signature
      let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"], 
        [userOp.signature, mockInvalidAuthModule.address]
      );
      userOp.signature = signatureWithModuleAddress;

      await expect(entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000})).to.be.revertedWith("FailedOp");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore);
    });

    it ("Reverts when trying to forward validateUserOp flow to the SENTINEL_MODULES", async () => {
      const { 
        entryPoint, 
        mockToken,
        userSA,
        ecdsaModule
      } = await setupTests();

      const sentinelAddress = "0x0000000000000000000000000000000000000001";
      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ]
      );
      const userOp = await fillAndSign(
        {
          sender: userSA.address,
          callData: txnDataAA1
        },
        smartAccountOwner,
        entryPoint,
        'nonce'
      );
      // add sentinel module address to the signature
      let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"], 
        [userOp.signature, sentinelAddress]
      );
      userOp.signature = signatureWithModuleAddress;

      await expect(entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000})).to.be.revertedWith("FailedOp");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore);
    });

    it ("Reverts when trying to forward validateUserOp flow to the module that is not enabled", async () => {
      const { 
        entryPoint, 
        mockToken,
        userSA,
        ecdsaModule
      } = await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ]
      );
      const userOp = await fillAndSign(
        {
          sender: userSA.address,
          callData: txnDataAA1
        },
        smartAccountOwner,
        entryPoint,
        'nonce'
      );
      // add not enabled module address to the signature
      let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"], 
        [userOp.signature, notEnabledModule.address]
      );
      userOp.signature = signatureWithModuleAddress;

      await expect(entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000})).to.be.revertedWith("FailedOp");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore);
    });

  });

});
