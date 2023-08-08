import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import { makeEcdsaModuleUserOp } from "../../utils/userOp";
import {
  BundlerTestEnvironment,
  Snapshot,
} from "../environment/bundlerEnvironment";

describe("Ownerless Smart Account Modules (with Bundler)", async () => {
  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] =
    await ethers.getSigners();

  let environment: BundlerTestEnvironment;
  let defaultSnapshot: Snapshot;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
    defaultSnapshot = await environment.snapshot();
  });

  const setupTests = deployments.createFixture(
    async ({ deployments, getNamedAccounts }) => {
      await deployments.fixture();

      const mockToken = await getMockToken();

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

  describe("enableModule: ", async () => {
    afterEach(async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
        this.skip();
      }

      await Promise.all([
        environment.revert(defaultSnapshot),
        environment.resetBundler(),
      ]);
    });

    it("Can enable module and it is enabled", async () => {
      const { ecdsaModule, userSA, entryPoint } = await setupTests();

      const MockAuthModule = await ethers.getContractFactory("MockAuthModule");
      const mockAuthModule = await MockAuthModule.deploy();

      const userOp = await makeEcdsaModuleUserOp(
        "enableModule",
        [mockAuthModule.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);

      expect(await userSA.isModuleEnabled(mockAuthModule.address)).to.be.true;
    });
  });

  describe("setupAndEnableModule: ", async () => {
    afterEach(async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
        this.skip();
      }

      await Promise.all([
        environment.revert(defaultSnapshot),
        environment.resetBundler(),
      ]);
    });

    it("Can enable and setup another module and it is enabled and setup", async () => {
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

      const userOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [socialRecoveryModule.address, socialRecoverySetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);

      expect(await userSA.isModuleEnabled(socialRecoveryModule.address)).to.be
        .true;

      expect(await socialRecoveryModule.isFriend(userSA.address, alice.address))
        .to.be.true;
      expect(await socialRecoveryModule.isFriend(userSA.address, bob.address))
        .to.be.true;
      expect(
        await socialRecoveryModule.isFriend(userSA.address, charlie.address)
      ).to.be.true;
      expect(
        await socialRecoveryModule.isFriend(userSA.address, deployer.address)
      ).to.be.false;
    });
  });

  describe("disableModule: ", async () => {
    afterEach(async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
        this.skip();
      }

      await Promise.all([
        environment.revert(defaultSnapshot),
        environment.resetBundler(),
      ]);
    });

    it("Can disable module and it is disabled", async () => {
      const { ecdsaModule, userSA, entryPoint } = await setupTests();

      const MockAuthModule = await ethers.getContractFactory("MockAuthModule");
      const module2 = await MockAuthModule.deploy();
      const module3 = await MockAuthModule.deploy();

      const userOp2 = await makeEcdsaModuleUserOp(
        "enableModule",
        [module2.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );
      await environment.sendUserOperation(userOp2, entryPoint.address);

      expect(await userSA.isModuleEnabled(module2.address)).to.be.true;

      const userOp3 = await makeEcdsaModuleUserOp(
        "enableModule",
        [module3.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );
      await environment.sendUserOperation(userOp3, entryPoint.address);
      expect(await userSA.isModuleEnabled(module3.address)).to.be.true;

      const userOpDisable = await makeEcdsaModuleUserOp(
        "disableModule",
        [module3.address, module2.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );
      await environment.sendUserOperation(userOpDisable, entryPoint.address);

      expect(await userSA.isModuleEnabled(module2.address)).to.be.false;
      expect(await userSA.isModuleEnabled(ethers.constants.AddressZero)).to.be
        .false;
      const returnedValue = await userSA.getModulesPaginated(
        "0x0000000000000000000000000000000000000001",
        10
      );
      expect(returnedValue.array.length).to.equal(2);
    });
  });
});
