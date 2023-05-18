import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { buildEOAModuleAuthorizedForwardTx } from "../src/utils/execution";
import { encodeTransfer } from "./smart-wallet/testUtils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEOAOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "./utils/setupHelper";
import { makeEOAModuleUserOp, makeEOAModuleUserOpWithPaymaster } from "./utils/userOp";
import { AddressZero } from "@ethersproject/constants";
import { Contract } from "ethers";

describe("Smart Account Factory", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();

    const mockToken = await getMockToken();
    
    const eoaModule = await getEOAOwnershipRegistryModule();

    return {
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      eoaModule: eoaModule,
    };
  });
  describe("Constructor", async () => {

    it ("reverts with zero address provided as implementation", async () => {
      const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");
      await expect(
        SmartAccountFactory.deploy(AddressZero)
      ).to.be.revertedWith("implementation cannot be zero");
    });

    it ("sets non-zero address implementation", async () => {
      const { smartAccountImplementation } = await setupTests();
      const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");
      const testFactory = await SmartAccountFactory.deploy(smartAccountImplementation.address);
      await testFactory.deployed();
      expect(await testFactory.basicImplementation()).to.equal(smartAccountImplementation.address);
    });

    it ("deploys Default Callback Handler instance", async () => {
      const { smartAccountImplementation } = await setupTests();
      const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");
      const testFactory = await SmartAccountFactory.deploy(smartAccountImplementation.address);
      await testFactory.deployed();
      const callbackHandlerAddress = await testFactory.minimalHandler();
      const callbackHandler = await ethers.getContractAt("DefaultCallbackHandler", callbackHandlerAddress);
      expect(await callbackHandler.NAME()).to.equal("Default Callback Handler");
    });

  });

  describe("Deploy CounterFactual Account", async () => { 

    it ("should deploy and init Smart Account and emit event", async () => {
      const { smartAccountFactory, eoaModule } = await setupTests();
      const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      
      let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await smartAccountOwner.getAddress()]
      );

      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

      const deploymentTx = await smartAccountFactory.deployCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);
      expect(deploymentTx).to.emit(smartAccountFactory, "AccountCreation").withArgs(expectedSmartAccountAddress, eoaModule.address, smartAccountDeploymentIndex);
      
      const smartAccount = await ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);
      expect(await smartAccount.isModuleEnabled(eoaModule.address)).to.equal(true);
      expect(await eoaModule.smartAccountOwners(smartAccount.address)).to.equal(smartAccountOwner.address);
    });

    it ("should revert if already deployed", async () => {   
      const { smartAccountFactory, eoaModule } = await setupTests();
      const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      
      let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await smartAccountOwner.getAddress()]
      );
      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);
      await smartAccountFactory.deployCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

      const expectedSmartAccountAddress2 = 
        await smartAccountFactory.getAddressForCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

      expect(expectedSmartAccountAddress).to.equal(expectedSmartAccountAddress2);
      await expect(smartAccountFactory.deployCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex)).
        to.be.revertedWith("Create2 call failed");
    });

    it ("should lead to different SA address when deploying SA with other owner", async () => {   
      const { smartAccountFactory, eoaModule } = await setupTests();
      const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      
      let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await smartAccountOwner.getAddress()]
      );
      let eoaOwnershipSetupData2 = EOAOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await alice.getAddress()]
      );
      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

      const expectedSmartAccountAddress2 = 
        await smartAccountFactory.getAddressForCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData2, smartAccountDeploymentIndex);

      expect(expectedSmartAccountAddress).to.not.equal(expectedSmartAccountAddress2);
    });
    
    it ("should revert if wrong setup data provided", async () => { 
      const { smartAccountFactory, eoaModule } = await setupTests();
      const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      
      let eoaOwnershipSetupData = "0xeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeE";
      const smartAccountDeploymentIndex = 0;

      await expect(smartAccountFactory.deployCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex)).
        to.be.revertedWith("");
    });

    it ("does not not allow to steal funds from counterfactual account", async () => { 
      const { smartAccountFactory, mockToken, eoaModule } = await setupTests();
      const mockTokensToMint = ethers.utils.parseEther("1000000");

      const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await smartAccountOwner.getAddress()]
      );
      const smartAccountDeploymentIndex = 0;

      const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

      await mockToken.mint(expectedSmartAccountAddress, mockTokensToMint);

      const fakeSetupData = (await ethers.getContractFactory("MockToken")).interface.encodeFunctionData(
        "transfer",
        [await alice.getAddress(), mockTokensToMint]
      );

      await expect(smartAccountFactory.deployCounterFactualAccount(mockToken.address, fakeSetupData, smartAccountDeploymentIndex)).
        to.be.revertedWith("ERC20: transfer amount exceeds balance");
      expect(await mockToken.balanceOf(expectedSmartAccountAddress)).to.equal(mockTokensToMint);
      expect(await mockToken.balanceOf(alice.address)).to.equal(0);
    });

  });


  describe("Deploy Account", async () => { 
    it ("should deploy and init Smart Account and emit event", async () => {
      const { smartAccountFactory, eoaModule } = await setupTests();
      const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      
      let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await smartAccountOwner.getAddress()]
      );

      const deploymentTx = await smartAccountFactory.deployAccount(eoaModule.address, eoaOwnershipSetupData);
      expect(deploymentTx).to.emit(smartAccountFactory, "AccountCreationWithoutIndex");
      
      //const smartAccount = await ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);
      //expect(await smartAccount.isModuleEnabled(eoaModule.address)).to.equal(true);
      //expect(await eoaModule.smartAccountOwners(smartAccount.address)).to.equal(smartAccountOwner.address);
    });

  });


});
