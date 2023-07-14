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
import { makeEcdsaModuleUserOp, makeMultiSignedUserOp } from "../utils/userOp";

describe("Social Recovery Module: ", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();

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
    
    // enable and setup Social Recovery Module
    let socialRecoverySetupData = socialRecoveryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [
        [keccak256(alice.address), keccak256(bob.address), keccak256(charlie.address)],
        [16741936496, 16741936496, 16741936496],
        [0, 0, 0],
        3,
        150
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
    };
  });

  it ("Can send a userOp", async () => {
    const { 
      entryPoint, 
      mockToken,
      userSA,
      socialRecoveryModule,
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

    const userOp = await makeMultiSignedUserOp(
      "executeCall",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      [charlie, alice, bob], // order is important
      entryPoint,
      socialRecoveryModule.address
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000});
    await handleOpsTxn.wait();

    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
  });


});
