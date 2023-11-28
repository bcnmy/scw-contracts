import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../utils/setupHelper";
import { makeEcdsaModuleUserOp, getUserOpHash } from "../utils/userOp";

describe("Modular Smart Account Modules: ", async () => {
  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] =
    waffle.provider.getWallets();
  const sentinelAddress = "0x0000000000000000000000000000000000000001";

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const mockToken = await getMockToken();
    const entryPoint = await getEntryPoint();
    const { chainId } = await entryPoint.provider.getNetwork();

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
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      chainId: chainId, 
    };
  });

  describe("enableModule: ", async () => {
    it("MOVED: Can enable module and it is enabled", async () => {
      // moved to test/bundler-integration/smart-account/SA.Modules.specs.ts
    });

    // can not enable address(0) as module
    it("Can not enable address(0) as module", async () => {
      const { ecdsaModule, userSA, entryPoint } = await setupTests();

      const userOp = await makeEcdsaModuleUserOp(
        "enableModule",
        [ethers.constants.AddressZero],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx = await entryPoint.handleOps([userOp], alice.address);
      expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // can not enable sentinel module
    it("Can not enable sentinel module", async () => {
      const { ecdsaModule, userSA, entryPoint } = await setupTests();

      const userOp = await makeEcdsaModuleUserOp(
        "enableModule",
        [sentinelAddress],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx = await entryPoint.handleOps([userOp], alice.address);
      expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.isModuleEnabled(sentinelAddress)).to.equal(false);
    });

    // can not enable module that is already enabled
    it("Can not enable module that is already enabled", async () => {
      const { ecdsaModule, userSA, entryPoint } = await setupTests();

      const MockAuthModule = await ethers.getContractFactory("MockAuthModule");
      const module1 = await MockAuthModule.deploy();

      const userOp1 = await makeEcdsaModuleUserOp(
        "enableModule",
        [module1.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx1 = await entryPoint.handleOps([userOp1], alice.address);
      await expect(tx1).to.not.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.isModuleEnabled(module1.address)).to.equal(true);

      const userOp2 = await makeEcdsaModuleUserOp(
        "enableModule",
        [module1.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx2 = await entryPoint.handleOps([userOp2], alice.address);
      expect(tx2).to.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.isModuleEnabled(module1.address)).to.equal(true);
    });
  });

  describe("setupAndEnableModule: ", async () => {
    it("Can not setup and enable invalid module", async () => {
      const { ecdsaModule, userSA, entryPoint } = await setupTests();

      const MockInvalidInitialAuthModule = await ethers.getContractFactory(
        "MockInvalidInitialAuthModule"
      );
      const mockInvalidInitialAuthModule =
        await MockInvalidInitialAuthModule.deploy();
      const invalidModuleSetupData =
        mockInvalidInitialAuthModule.interface.encodeFunctionData("init", [
          "0xabcdef",
        ]);

      const userOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [mockInvalidInitialAuthModule.address, invalidModuleSetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");

      expect(
        await userSA.isModuleEnabled(mockInvalidInitialAuthModule.address)
      ).to.equal(false);
      expect(
        await userSA.isModuleEnabled(ethers.constants.AddressZero)
      ).to.equal(false);
    });

    it("MOVED: Can enable and setup another module and it is enabled and setup", async () => {
      // moved to test/bundler-integration/smart-account/SA.Modules.specs.ts
    });

    // can not enable address(0) as module
    it("Can not setup and enable address(0) as module", async () => {
      const { ecdsaModule, userSA, entryPoint } = await setupTests();

      const invalidSetupData = "0x";

      const userOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [ethers.constants.AddressZero, invalidSetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx = await entryPoint.handleOps([userOp], alice.address);

      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
      expect(
        await userSA.isModuleEnabled(ethers.constants.AddressZero)
      ).to.equal(false);
    });

    // can not enable sentinel module
    it("Can not setup and enable sentinel module", async () => {
      const { ecdsaModule, userSA, entryPoint } = await setupTests();

      const invalidSetupData = "0x";

      const userOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [sentinelAddress, invalidSetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.isModuleEnabled(sentinelAddress)).to.equal(false);
    });

    // can not enable module that is already enabled
    it("Can not setup and enable module that is already enabled", async () => {
      const { ecdsaModule, userSA, entryPoint } = await setupTests();

      const SocialRecoveryModule = await ethers.getContractFactory(
        "SocialRecoveryModule"
      );
      const socialRecoveryModule = await SocialRecoveryModule.deploy();

      const socialRecoverySetupData =
        SocialRecoveryModule.interface.encodeFunctionData("setup", [
          [
            await alice.getAddress(),
            await bob.getAddress(),
            await charlie.getAddress(),
          ],
          2,
        ]);

      const userOp1 = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [socialRecoveryModule.address, socialRecoverySetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx1 = await entryPoint.handleOps([userOp1], alice.address);
      await expect(tx1).to.not.emit(entryPoint, "UserOperationRevertReason");
      expect(
        await userSA.isModuleEnabled(socialRecoveryModule.address)
      ).to.equal(true);

      const userOp2 = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [socialRecoveryModule.address, socialRecoverySetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx2 = await entryPoint.handleOps([userOp2], alice.address);
      await expect(tx2).to.emit(entryPoint, "UserOperationRevertReason");
      expect(
        await userSA.isModuleEnabled(socialRecoveryModule.address)
      ).to.equal(true);
    });
  });

  describe("disableModule: ", async () => {
    it("MOVED: Can disable module and it is disabled", async () => {
      // moved to test/bundler-integration/smart-account/SA.Modules.specs.ts
    });

    it("Can not disable the only module", async () => {
      const { ecdsaModule, userSA, entryPoint, chainId } = await setupTests();

      const userOp = await makeEcdsaModuleUserOp(
        "disableModule",
        [sentinelAddress, ecdsaModule.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const errorData = ethers.utils.hexConcat([
        ethers.utils.id("CanNotDisableOnlyModule(address)").slice(0, 10),
        ethers.utils.hexZeroPad(ecdsaModule.address, 32),
      ]);

      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason")
        .withArgs(
          getUserOpHash(userOp, entryPoint.address, chainId),
          userOp.sender,
          userOp.nonce,
          errorData
        );
      expect(await userSA.isModuleEnabled(ecdsaModule.address)).to.equal(
        true
      );
    });
  });

  describe("execTransactionFromModule: ", async () => {
    // execTransactionFromModule is successfuly tested in the ../module/ForwardFlowModule.specs.ts
  });

  describe("execBatchTransactionFromModule: ", async () => {
    //
  });
});
