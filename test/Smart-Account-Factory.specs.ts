import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import {
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getEntryPoint,
} from "./utils/setupHelper";
import { AddressZero } from "@ethersproject/constants";

describe("Smart Account Factory", async () => {
  const [deployer, smartAccountOwner, alice, charlie] =
    waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const mockToken = await getMockToken();

    const ecdsaModule = await getEcdsaOwnershipRegistryModule();

    const entryPoint = await getEntryPoint();

    return {
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      entryPoint: entryPoint,
    };
  });
  describe("Constructor", async () => {
    it("reverts with zero address provided as implementation", async () => {
      const SmartAccountFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );
      await expect(
        SmartAccountFactory.deploy(AddressZero, deployer.address)
      ).to.be.revertedWith("implementation cannot be zero");
    });

    it("sets non-zero address implementation", async () => {
      const { smartAccountImplementation } = await setupTests();
      const SmartAccountFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );
      const testFactory = await SmartAccountFactory.deploy(
        smartAccountImplementation.address,
        deployer.address
      );
      await testFactory.deployed();
      expect(await testFactory.basicImplementation()).to.equal(
        smartAccountImplementation.address
      );
    });

    it("deploys Default Callback Handler instance", async () => {
      const { smartAccountImplementation } = await setupTests();
      const SmartAccountFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );
      const testFactory = await SmartAccountFactory.deploy(
        smartAccountImplementation.address,
        deployer.address
      );
      await testFactory.deployed();
      const callbackHandlerAddress = await testFactory.minimalHandler();
      const callbackHandler = await ethers.getContractAt(
        "DefaultCallbackHandler",
        callbackHandlerAddress
      );
      expect(await callbackHandler.NAME()).to.equal("Default Callback Handler");
    });

    it("successfully changes owner to a new one", async () => {
      const { smartAccountImplementation } = await setupTests();
      const SmartAccountFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );
      const testFactory = await SmartAccountFactory.deploy(
        smartAccountImplementation.address,
        charlie.address
      );
      await testFactory.deployed();
      expect(await testFactory.owner()).to.equal(charlie.address);
      expect(await testFactory.owner()).to.not.equal(deployer.address);
    });
  });

  describe("Stakeable", async () => {
    it("can add stake to the EP", async () => {
      const { smartAccountFactory, entryPoint } = await setupTests();
      const stakeAmount = ethers.utils.parseEther("1.234256");
      await smartAccountFactory.addStake(entryPoint.address, 600, {
        value: stakeAmount,
      });
      const depositInfo = await entryPoint.getDepositInfo(
        smartAccountFactory.address
      );
      expect(depositInfo.stake).to.equal(stakeAmount);
    });

    // can unlock

    // can withdraw

    // not owner cannot add, unlock, withdraw
  });

  describe("Deploy CounterFactual Account", async () => {
    it("should deploy and init Smart Account and emit event", async () => {
      const { smartAccountFactory, ecdsaModule, smartAccountImplementation } =
        await setupTests();
      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );

      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );

      const deploymentTx =
        await smartAccountFactory.deployCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );
      expect(deploymentTx)
        .to.emit(smartAccountFactory, "AccountCreation")
        .withArgs(
          expectedSmartAccountAddress,
          ecdsaModule.address,
          smartAccountDeploymentIndex
        );

      const smartAccount = await ethers.getContractAt(
        "SmartAccount",
        expectedSmartAccountAddress
      );
      expect(await smartAccount.getImplementation()).to.equal(
        await smartAccountFactory.basicImplementation()
      );
      expect(await smartAccount.entryPoint()).to.equal(
        await smartAccountImplementation.entryPoint()
      );
      expect(await smartAccount.isModuleEnabled(ecdsaModule.address)).to.equal(
        true
      );
      expect(await ecdsaModule.getOwner(smartAccount.address)).to.equal(
        smartAccountOwner.address
      );
      expect(await smartAccount.nonce(0)).to.equal(0);
    });

    it("should revert if already deployed", async () => {
      const { smartAccountFactory, ecdsaModule } = await setupTests();
      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );
      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );
      await smartAccountFactory.deployCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

      const expectedSmartAccountAddress2 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );

      expect(expectedSmartAccountAddress).to.equal(
        expectedSmartAccountAddress2
      );
      await expect(
        smartAccountFactory.deployCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        )
      ).to.be.revertedWith("Create2 call failed");
    });

    it("should lead to different SA address when deploying SA with other owner", async () => {
      const { smartAccountFactory, ecdsaModule } = await setupTests();
      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );
      const ecdsaOwnershipSetupData2 =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await alice.getAddress()]
        );
      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );

      const expectedSmartAccountAddress2 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData2,
          smartAccountDeploymentIndex
        );

      expect(expectedSmartAccountAddress).to.not.equal(
        expectedSmartAccountAddress2
      );
    });

    it("should revert if wrong setup data provided", async () => {
      const { smartAccountFactory, ecdsaModule } = await setupTests();

      const ecdsaOwnershipSetupData = "0xeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeE";
      const smartAccountDeploymentIndex = 0;

      await expect(
        smartAccountFactory.deployCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        )
      ).to.be.revertedWith("");
    });

    it("does not not allow to steal funds from counterfactual account", async () => {
      const { smartAccountFactory, mockToken, ecdsaModule } =
        await setupTests();
      const mockTokensToMint = ethers.utils.parseEther("1000000");

      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );
      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );
      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );

      await mockToken.mint(expectedSmartAccountAddress, mockTokensToMint);

      const fakeSetupData = (
        await ethers.getContractFactory("MockToken")
      ).interface.encodeFunctionData("transfer", [
        await alice.getAddress(),
        mockTokensToMint,
      ]);

      await expect(
        smartAccountFactory.deployCounterFactualAccount(
          mockToken.address,
          fakeSetupData,
          smartAccountDeploymentIndex
        )
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      expect(await mockToken.balanceOf(expectedSmartAccountAddress)).to.equal(
        mockTokensToMint
      );
      expect(await mockToken.balanceOf(alice.address)).to.equal(0);
    });
  });

  describe("Deploy Account", async () => {
    it("should deploy and init Smart Account and emit event", async () => {
      const { smartAccountFactory, ecdsaModule } = await setupTests();
      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );

      const deploymentTx = await smartAccountFactory.deployAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData
      );
      expect(deploymentTx).to.emit(
        smartAccountFactory,
        "AccountCreationWithoutIndex"
      );

      const receipt = await deploymentTx.wait();
      const deployedSmartAccountAddress = receipt.events[1].args[0];

      const smartAccount = await ethers.getContractAt(
        "SmartAccount",
        deployedSmartAccountAddress
      );
      expect(await smartAccount.isModuleEnabled(ecdsaModule.address)).to.equal(
        true
      );
      expect(await ecdsaModule.getOwner(smartAccount.address)).to.equal(
        smartAccountOwner.address
      );
    });

    it("should revert if wrong setup data provided", async () => {
      const { smartAccountFactory, ecdsaModule } = await setupTests();

      const ecdsaOwnershipSetupData = "0xeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeE";

      await expect(
        smartAccountFactory.deployAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData
        )
      ).to.be.revertedWith("");
    });
  });
});
