import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import {
  SmartAccount,
  SmartAccountFactory,
  MockToken,
  EOAOwnershipRegistryModule,
} from "../../typechain";
import {
  SafeTransaction,
  Transaction,
  FeeRefund,
  safeSignTypedData,
  buildSafeTransaction,
} from "../../src/utils/execution";
import { encodeTransfer } from "../smart-wallet/testUtils";
import { 
  deployContract, 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEOAOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../utils/setupHelper";
import { fillAndSign } from "../utils/userOp";
import { arrayify } from "ethers/lib/utils";
import { Signer } from "ethers";
export const AddressZero = "0x0000000000000000000000000000000000000000";
export const AddressOne = "0x0000000000000000000000000000000000000001";


describe("Ownerless Smart Account Basics: ", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie] = waffle.provider.getWallets();

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

    console.log("mint tokens to userSCW address..");
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));
    
    return {
      entryPoint: await getEntryPoint(),
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      eoaModule: eoaModule,
      userSA: userSA,
    };
  });

  it ("Should deploy SA with default module", async () => {
    const { 
      entryPoint, 
      smartAccountImplementation, 
      smartAccountFactory, 
      mockToken,
      eoaModule,
      userSA
    } = await setupTests();

    expect(await userSA.isModuleEnabled(eoaModule.address)).to.equal(true);
    expect(await eoaModule.smartAccountOwners(userSA.address)).to.equal(smartAccountOwner.address);

    expect(await ethers.provider.getBalance(userSA.address)).to.equal(ethers.utils.parseEther("10"));
    expect(await mockToken.balanceOf(userSA.address)).to.equal(ethers.utils.parseEther("1000000"));

    /*
    console.log("EntryPoint deployed at: ", entryPoint.address);
    console.log("Implementation deployed at %s using %s as EntryPoint: ", smartAccountImplementation.address, await smartAccountImplementation.entryPoint());
    console.log("Factory deployed at ", smartAccountFactory.address);
    console.log("MockToken deployed at ", mockToken.address);
    console.log("EOA Ownership Registry Module deployed at ", eoaModule.address);
    */
  });

  it ("Can send a userOp", async () => {
    const { 
      entryPoint, 
      mockToken,
      userSA,
      eoaModule
    } = await setupTests();

    const SmartAccount = await ethers.getContractFactory("SmartAccount");
    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
      "executeCall",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ]
    );

    const userOp1 = await fillAndSign(
      {
        sender: userSA.address,
        callData: txnDataAA1,
        callGasLimit: 1_000_000,
      },
      smartAccountOwner,
      entryPoint,
      'nonce'
    );

    // add validator module address to the signature
    let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"], 
      [userOp1.signature, eoaModule.address]
    );
    userOp1.signature = signatureWithModuleAddress;

    const handleOpsTxn = await entryPoint.handleOps([userOp1], alice.address, {
      gasLimit: 10000000,
    });

    await handleOpsTxn.wait();

    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));

  });

  it ("Can verify a signature through isValidSignature", async () => {
    //
  });


});
