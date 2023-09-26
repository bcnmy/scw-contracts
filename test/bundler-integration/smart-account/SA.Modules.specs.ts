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
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Modular Smart Account Modules (with Bundler)", async () => {
  let deployer: SignerWithAddress,
    smartAccountOwner: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    charlie: SignerWithAddress,
    verifiedSigner: SignerWithAddress;

  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] =
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
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  describe("enableModule: ", async () => {
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

      expect(await userSA.isModuleEnabled(mockAuthModule.address)).to.equal(
        true
      );
    });
  });

  describe("setupAndEnableModule: ", async () => {
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

      expect(
        await userSA.isModuleEnabled(socialRecoveryModule.address)
      ).to.equal(true);
      expect(
        await socialRecoveryModule.isFriend(userSA.address, alice.address)
      ).to.equal(true);
      expect(
        await socialRecoveryModule.isFriend(userSA.address, bob.address)
      ).to.equal(true);
      expect(
        await socialRecoveryModule.isFriend(userSA.address, charlie.address)
      ).to.equal(true);
      expect(
        await socialRecoveryModule.isFriend(userSA.address, deployer.address)
      ).to.equal(false);
    });
  });

  describe("disableModule: ", async () => {
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

      expect(await userSA.isModuleEnabled(module2.address)).to.equal(true);

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
      expect(await userSA.isModuleEnabled(module3.address)).to.equal(true);

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

      expect(await userSA.isModuleEnabled(module2.address)).to.equal(false);
      expect(
        await userSA.isModuleEnabled(ethers.constants.AddressZero)
      ).to.equal(false);
      const returnedValue = await userSA.getModulesPaginated(
        "0x0000000000000000000000000000000000000001",
        10
      );
      expect(returnedValue.array.length).to.equal(2);
    });
  });
});
