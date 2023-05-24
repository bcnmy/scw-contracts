import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { encodeTransfer } from "../smart-wallet/testUtils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEOAOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import { makeEOAModuleUserOp, makeEOAModuleUserOpWithPaymaster } from "../utils/userOp";
import { AddressZero } from "@ethersproject/constants";

describe("NEW::: Smart Account Setup ", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();

    const mockToken = await getMockToken();
    
    const eoaModule = await getEOAOwnershipRegistryModule();
    const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      
    let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );

    const smartAccountDeploymentIndex = 0;

    const userSA = await getSmartAccountWithModule(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

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
      eoaModule: eoaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  describe("Initialization", async () => {

    it ("Sets the default callback handler", async () => {
      const { 
        smartAccountFactory,
        userSA
      } = await setupTests();

      expect(await userSA.getFallbackHandler()).to.equal(await smartAccountFactory.minimalHandler());
    });

    it ("Setups the default authorization module", async () => {
      const { 
        eoaModule,
        userSA
      } = await setupTests();

      expect(await userSA.isModuleEnabled(eoaModule.address)).to.equal(true);
      expect(await eoaModule.smartAccountOwners(userSA.address)).to.equal(smartAccountOwner.address);
    });

    it ("Can not be called after proxy deployment", async () => {
      const { 
        eoaModule,
        userSA
      } = await setupTests();
      
      await expect(
        userSA.init(
          AddressZero,
          eoaModule.address,
          "0x"
        )
      ).to.be.revertedWith("AlreadyInitialized");
    });

    it ("Can not be called on implementation", async () => {
      const { 
        smartAccountImplementation,
        eoaModule
      } = await setupTests();

      await expect(
        smartAccountImplementation.init(
          AddressZero,
          eoaModule.address,
          "0x"
        )
      ).to.be.revertedWith("AlreadyInitialized");
    });
  });

  describe("Update Implementation", async () => {

    it ("Can not be called not from EntryPoint or Self", async () => {
      const { 
        smartAccountImplementation,
        userSA,
      } = await setupTests();

      await expect(
        userSA.updateImplementation(AddressZero)
      ).to.be.revertedWith("CallerIsNotEntryPointOrSelf").withArgs(deployer.address);
      expect(await userSA.getImplementation()).to.equal(smartAccountImplementation.address);
    });
    
    it ("can not set address(0) as implementation", async () => {
      const { 
        entryPoint,
        eoaModule,
        userSA,
      } = await setupTests();

      const userOp = await makeEOAModuleUserOp(
        "updateImplementation",
        [
          AddressZero
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        eoaModule.address
      )
      const implementationInSaBefore = await userSA.getImplementation();
      const handleOpsTx = await entryPoint.handleOps([userOp], alice.address);
      expect(handleOpsTx).to.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.getImplementation()).to.equal(implementationInSaBefore);
    });

    //can not set eoa as implementation
    it ("can not set EOA as implementation", async () => {
      const { 
        entryPoint,
        eoaModule,
        userSA,
      } = await setupTests();

      const userOp = await makeEOAModuleUserOp(
        "updateImplementation",
        [
          bob.address
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        eoaModule.address
      )
      const implementationInSaBefore = await userSA.getImplementation();
      const handleOpsTx = await entryPoint.handleOps([userOp], alice.address);
      expect(handleOpsTx).to.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.getImplementation()).to.equal(implementationInSaBefore);
    });

    //updates the implementation and calls are forwarded to the new implementation and the event 
      
  });

  

});
