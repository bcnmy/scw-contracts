import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { buildEOAModuleAuthorizedForwardTx } from "../../src/utils/execution";
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

describe("NEW::: Ownerless Smart Account Modules: ", async () => {

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

  describe ("setupAndEnableModule: ", async () => {
    it ("Can enable and setup second module and it is enabled and setup", async () => {
      const { 
        eoaModule,
        userSA,
        entryPoint
      } = await setupTests();

      const SocialRecoveryModule = await ethers.getContractFactory("SocialRecoveryModule");
      const socialRecoveryModule = await SocialRecoveryModule.deploy();

      let socialRecoverySetupData = SocialRecoveryModule.interface.encodeFunctionData(
        "setup",
        [[await alice.getAddress(), await bob.getAddress(), await charlie.getAddress()], 2]
      );

      let userOp = await makeEOAModuleUserOp(
        "setupAndEnableModule",
        [socialRecoveryModule.address, socialRecoverySetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        eoaModule.address
      );
      
      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");

      expect(await userSA.isModuleEnabled(socialRecoveryModule.address)).to.be.true;
      
      expect(await socialRecoveryModule.isFriend(userSA.address, alice.address)).to.be.true;
      expect(await socialRecoveryModule.isFriend(userSA.address, bob.address)).to.be.true;
      expect(await socialRecoveryModule.isFriend(userSA.address, charlie.address)).to.be.true;
      expect(await socialRecoveryModule.isFriend(userSA.address, deployer.address)).to.be.false;
      
    });

    // try to setup a module that does not return address from setup
    


  });

});
