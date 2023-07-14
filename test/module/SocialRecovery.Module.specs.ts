import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { keccak256 } from "ethers/lib/utils";
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
import { makeEcdsaModuleUserOp, makeMultiSignedUserOp, makeUnsignedUserOp } from "../utils/userOp";


describe("Social Recovery Module: ", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner, eve, fox, newOwner] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    await deployments.fixture();
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const mockToken = await getMockToken();
    const entryPoint = await getEntryPoint();
    
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory("EcdsaOwnershipRegistryModule");
      
    let ecdsaOwnershipSetupData = EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );
    const smartAccountDeploymentIndex = 0;
    const userSA = await getSmartAccountWithModule(ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex);

    // fill acct balance
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    // deploy Social Recovery Module
    const socialRecoveryModule = await (await ethers.getContractFactory("SocialRecoveryModule")).deploy();
    
    const defaultSecurityDelay = 150;
    // enable and setup Social Recovery Module
    let socialRecoverySetupData = socialRecoveryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [
        [keccak256(alice.address), keccak256(bob.address), keccak256(charlie.address)],
        [16741936496, 16741936496, 16741936496],
        [0, 0, 0],
        3,
        defaultSecurityDelay,
      ]
    );
    const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
      "setupAndEnableModule",
      [
        socialRecoveryModule.address,
        socialRecoverySetupData
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    await entryPoint.handleOps([setupAndEnableUserOp], alice.address);  
    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      socialRecoveryModule: socialRecoveryModule,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
      defaultSecurityDelay: defaultSecurityDelay,
    };
  });

  it ("Can send a userOp", async () => {
    const { 
      entryPoint, 
      mockToken,
      userSA,
      socialRecoveryModule,
      ecdsaModule, 
      defaultSecurityDelay
    } = await setupTests();

    console.log("social recovery module address: ", socialRecoveryModule.address);
    console.log("alice address: %s hash: %s", alice.address, keccak256(alice.address));
    console.log("bob address: %s hash: %s", bob.address, keccak256(bob.address));
    console.log("charlie address: %s hash1: %s", charlie.address, keccak256(charlie.address));

    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    let arrayOfSigners = [alice, bob, charlie];
    arrayOfSigners.sort((a, b) => a.address.localeCompare(b.address));
    //console.log("arrayOfSigners: ", arrayOfSigners);

    expect(await userSA.isModuleEnabled(socialRecoveryModule.address)).to.equal(true);

    const recoveryRequestCallData = userSA.interface.encodeFunctionData(
      "executeCall",
      [
        ecdsaModule.address,
        ethers.utils.parseEther("0"),
        ecdsaModule.interface.encodeFunctionData(
          "transferOwnership",
          [newOwner.address]
        ),
      ]
    )

    const userOp = await makeMultiSignedUserOp(
      "executeCall",
      [
        socialRecoveryModule.address,
        ethers.utils.parseEther("0"),
        socialRecoveryModule.interface.encodeFunctionData(
          "submitRecoveryRequest",
          [
            recoveryRequestCallData
          ]
        ),
      ],
      userSA.address,
      [charlie, alice, bob], // order is important
      entryPoint,
      socialRecoveryModule.address
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000});
    await handleOpsTxn.wait();

    const recoveryRequest = await socialRecoveryModule.getRecoverRequest(userSA.address);
    expect(recoveryRequest.callDataHash).to.equal(ethers.utils.keccak256(recoveryRequestCallData));
    expect(await ecdsaModule.getOwner(userSA.address)).to.equal(smartAccountOwner.address);

    // can be non signed at all, just needs to be executed after the delay
    const executeRecoveryRequestUserOp = await makeUnsignedUserOp(
      "executeCall",
      [
        ecdsaModule.address,
        ethers.utils.parseEther("0"),
        ecdsaModule.interface.encodeFunctionData(
          "transferOwnership",
          [newOwner.address]
        ),
      ],
      userSA.address,
      entryPoint,
      socialRecoveryModule.address
    );
    await expect(
      entryPoint.handleOps([executeRecoveryRequestUserOp], alice.address, {gasLimit: 10000000})
    ).to.be.revertedWith("FailedOp").withArgs(0, "AA22 expired or not due");

    await ethers.provider.send("evm_increaseTime", [defaultSecurityDelay+12]);
    await ethers.provider.send("evm_mine", []);

    await entryPoint.handleOps([executeRecoveryRequestUserOp], alice.address, {gasLimit: 10000000});
    expect(await ecdsaModule.getOwner(userSA.address)).to.equal(newOwner.address);
    expect(await ecdsaModule.getOwner(userSA.address)).to.not.equal(smartAccountOwner.address);
  });

  describe ("addGuardian", async () => {

    it ("Can add a guardian", async () => {
      const { 
        entryPoint, 
        userSA,
        socialRecoveryModule,
        ecdsaModule
      } = await setupTests();

      const newGuardian = ethers.utils.keccak256(eve.address);
      const guardiansBefore = (await socialRecoveryModule.getSmartAccountSettings(userSA.address)).guardiansCount;

      const addGuardianData = socialRecoveryModule.interface.encodeFunctionData(
        "addGuardian",
        [
          newGuardian,
          16741936496,
          0
        ]
      );

      const addGuardianUserOp = await makeEcdsaModuleUserOp(
        "executeCall",
        [
          socialRecoveryModule.address,
          ethers.utils.parseEther("0"),
          addGuardianData,
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      const handleOpsTxn = await entryPoint.handleOps([addGuardianUserOp], alice.address, {gasLimit: 10000000});
      const receipt = await handleOpsTxn.wait();
      const receiptTimestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp;

      const userSASettings = await socialRecoveryModule.getSmartAccountSettings(userSA.address);
      const guardiansAfter = userSASettings.guardiansCount;

      const eveTimeFrame = await socialRecoveryModule.getGuardianDetails(newGuardian, userSA.address);
      expect(eveTimeFrame.validUntil).to.equal(16741936496);
      expect(eveTimeFrame.validAfter).to.equal(receiptTimestamp + userSASettings.securityDelay);
      expect(guardiansAfter).to.equal(guardiansBefore + 1);
    });

    
  });

});
