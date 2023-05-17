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

    it ("should deploy Smart Account and initialize it with the correct init data", async () => {
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

    });

    

    // should revert if wrong setup contract or data provided

  });


});
