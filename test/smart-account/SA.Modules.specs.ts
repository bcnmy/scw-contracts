import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { buildecdsaModuleAuthorizedForwardTx } from "../../src/utils/execution";
import { AddressZero } from "../aa-core/testutils";
import { encodeTransfer } from "../smart-wallet/testUtils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import { makeEcdsaModuleUserOp, makeEcdsaModuleUserOpWithPaymaster } from "../utils/userOp";

describe("NEW::: Ownerless Smart Account Modules: ", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();

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

  describe ("enableModule: ", async () => {

    it ("Can enable module and it is enabled", async () => {
      const { 
        ecdsaModule,
        userSA,
        entryPoint
      } = await setupTests();

      const MockAuthModule = await ethers.getContractFactory("MockAuthModule");
      const mockAuthModule = await MockAuthModule.deploy();

      let userOp = await makeEcdsaModuleUserOp(
        "enableModule",
        [mockAuthModule.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");

      expect(await userSA.isModuleEnabled(mockAuthModule.address)).to.be.true;
    });

    // can not enable address(0) as module

    // can not enable sentinel module

    // can not enable module that is already enabled

  });

  describe ("setupAndEnableModule: ", async () => {

    it ("Can not setup and enable invalid module", async () => {
      const { 
        ecdsaModule,
        userSA,
        entryPoint
      } = await setupTests();

      const MockInvalidInitialAuthModule = await ethers.getContractFactory("MockInvalidInitialAuthModule");
      const mockInvalidInitialAuthModule = await MockInvalidInitialAuthModule.deploy();
      const invalidModuleSetupData = mockInvalidInitialAuthModule.interface.encodeFunctionData("init", ["0xabcdef"]);

      let userOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [mockInvalidInitialAuthModule.address, invalidModuleSetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      
      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");

      expect(await userSA.isModuleEnabled(mockInvalidInitialAuthModule.address)).to.be.false;
      expect(await userSA.isModuleEnabled(AddressZero)).to.be.false;
    });

    it ("Can enable and setup another module and it is enabled and setup", async () => {
      const { 
        ecdsaModule,
        userSA,
        entryPoint
      } = await setupTests();

      const SocialRecoveryModule = await ethers.getContractFactory("SocialRecoveryModule");
      const socialRecoveryModule = await SocialRecoveryModule.deploy();

      let socialRecoverySetupData = SocialRecoveryModule.interface.encodeFunctionData(
        "setup",
        [[await alice.getAddress(), await bob.getAddress(), await charlie.getAddress()], 2]
      );

      let userOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [socialRecoveryModule.address, socialRecoverySetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      
      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");

      expect(await userSA.isModuleEnabled(socialRecoveryModule.address)).to.be.true;
      
      expect(await socialRecoveryModule.isFriend(userSA.address, alice.address)).to.be.true;
      expect(await socialRecoveryModule.isFriend(userSA.address, bob.address)).to.be.true;
      expect(await socialRecoveryModule.isFriend(userSA.address, charlie.address)).to.be.true;
      expect(await socialRecoveryModule.isFriend(userSA.address, deployer.address)).to.be.false;
    });

    // can not enable address(0) as module

    // can not enable sentinel module

    // can not enable module that is already enabled

  });

  describe ("disableModule: ", async () => {
    it ("Can disable module and it is disabled", async () => {
      const { 
        ecdsaModule,
        userSA,
        entryPoint
      } = await setupTests();

      const MockAuthModule = await ethers.getContractFactory("MockAuthModule");
      const module2 = await MockAuthModule.deploy();
      const module3 = await MockAuthModule.deploy();

      let userOp2 = await makeEcdsaModuleUserOp(
        "enableModule",
        [module2.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      let tx = await entryPoint.handleOps([userOp2], alice.address);
      await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.isModuleEnabled(module2.address)).to.be.true;

      let userOp3 = await makeEcdsaModuleUserOp(
        "enableModule",
        [module3.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      tx = await entryPoint.handleOps([userOp3], alice.address);
      await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.isModuleEnabled(module3.address)).to.be.true;

      let userOpDisable = await makeEcdsaModuleUserOp(
        "disableModule",
        [module3.address, module2.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      tx = await entryPoint.handleOps([userOpDisable], alice.address);
      await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");

      expect(await userSA.isModuleEnabled(module2.address)).to.be.false;
      expect(await userSA.isModuleEnabled(AddressZero)).to.be.false;
      const returnedValue = await userSA.getModulesPaginated("0x0000000000000000000000000000000000000001", 10);
      expect(returnedValue.array.length).to.equal(2);
    });
  });

  // Don't test until I remove delegatecalls from ModuleManager
  /*
  describe ("execTransactionFromModule: ", async () => { 
     


  });

  describe ("execBatchTransactionFromModule: ", async () => { 
    


  });
  */

});
