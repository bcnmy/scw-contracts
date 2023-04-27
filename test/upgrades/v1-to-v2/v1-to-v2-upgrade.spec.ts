import { expect } from "chai";
import { ethers } from "hardhat";
import {
  SmartAccountV1,
  SmartAccountFactoryV1,
  SmartAccount,
  SmartAccountFactory,
  EntryPoint,
  EntryPoint__factory,
  VerifyingSingletonPaymaster,
  VerifyingSingletonPaymaster__factory,
  MockToken,
  DefaultCallbackHandler,
  EOAOwnershipRegistryModule,
} from "../../../typechain";
import {
  SafeTransaction,
  Transaction,
  FeeRefund,
  safeSignTypedData,
  buildSafeTransaction,
} from "../../../src/utils/execution";
import { encodeTransfer } from "../../smart-wallet/testUtils";
import { fillAndSign } from "../../utils/userOp";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";
import { Signer } from "ethers";
import { UserOperation } from "../../utils/userOperation";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

describe("Upgrade EOA Owned (v1) to Ownerless (v2)", function () {
  let entryPoint: EntryPoint;
  let latestEntryPoint: EntryPoint;
  let walletOwner: Signer;
  let paymasterAddress: string;
  let offchainSigner: Signer, deployer: Signer;
  let verifyingSingletonPaymaster: VerifyingSingletonPaymaster;
  let baseImplV1: SmartAccountV1;
  let walletFactoryV1: SmartAccountFactoryV1;
  let baseImpl: SmartAccount;
  let walletFactory: SmartAccountFactory;
  let token: MockToken;
  let eoaOwnersRegistryModule: EOAOwnershipRegistryModule;
  let walletOwnerAddress: string;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();
    entryPoint = await deployEntryPoint();

    deployer = accounts[0];
    offchainSigner = accounts[1];
    walletOwner = accounts[5];

    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();
    walletOwnerAddress = await accounts[5].getAddress();

    const offchainSignerAddress = await offchainSigner.getAddress();
    
    //  ====== v1 ===========  

    const BaseImplementationV1 = await ethers.getContractFactory("SmartAccountV1");
    baseImplV1 = await BaseImplementationV1.deploy(entryPoint.address);
    await baseImplV1.deployed();
    console.log("base wallet impl V1 deployed at: ", baseImplV1.address);

    const WalletFactoryV1 = await ethers.getContractFactory(
      "SmartAccountFactoryV1"
    );
    walletFactoryV1 = await WalletFactoryV1.deploy(baseImplV1.address);
    await walletFactoryV1.deployed();
    console.log("wallet factory V1 deployed at: ", walletFactoryV1.address);

    //  ====== v2 ===========  
    const BaseImplementation = await ethers.getContractFactory("SmartAccount");
    baseImpl = await BaseImplementation.deploy(entryPoint.address);
    await baseImpl.deployed();
    console.log("base wallet impl deployed at: ", baseImpl.address);

    const WalletFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    walletFactory = await WalletFactory.deploy(baseImpl.address);
    await walletFactory.deployed();
    console.log("wallet factory deployed at: ", walletFactory.address);

    //  =================

    const EOAOwnersModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
    eoaOwnersRegistryModule = await EOAOwnersModule.connect(accounts[0]).deploy();
    console.log("EOA Owners Registry Module deployed at ", eoaOwnersRegistryModule.address);

    const MockToken = await ethers.getContractFactory("MockToken");
    token = await MockToken.deploy();
    await token.deployed();
    console.log("Test token deployed at: ", token.address);

    console.log("mint tokens to owner address..");
    await token.mint(walletOwnerAddress, ethers.utils.parseEther("1000000"));
  });

  describe("Test Upgrade From V1 to V2", function () {

    it("Deploys V1 SCW and sends txn", async () => {
        
        const charlieBalBefore = await ethers.provider.getBalance(charlie);

        const expectedSmartAccountAddress =
            await walletFactoryV1.getAddressForCounterFactualAccount(walletOwnerAddress, 0);
        
        await walletFactoryV1.deployCounterFactualAccount(walletOwnerAddress, 0);

        userSCW = await ethers.getContractAt(
            "contracts/smart-contract-wallet/test/upgrades/v1/SmartAccountV1.sol:SmartAccountV1",
            expectedSmartAccountAddress
        );

        await accounts[1].sendTransaction({
            from: bob,
            to: expectedSmartAccountAddress,
            value: ethers.utils.parseEther("5"),
        });

        const SmartAccountV1 = await ethers.getContractFactory("SmartAccountV1");

        const txnData = SmartAccountV1.interface.encodeFunctionData("executeCall", [
            charlie,
            ethers.utils.parseEther("1"),
            "0x",
        ]);

        const userOp1 = await fillAndSign(
            {
            sender: expectedSmartAccountAddress,
            callData: txnData,
            verificationGasLimit: 200000,
            },
            walletOwner,
            entryPoint,
            'nonce'
        );

        const userOpHash = await entryPoint?.getUserOpHash(userOp1);

        await entryPoint.handleOps([userOp1], await offchainSigner.getAddress());

        const balCharlieActual = await ethers.provider.getBalance(charlie);
        expect(balCharlieActual).to.be.equal(
            charlieBalBefore.add(ethers.utils.parseEther("1"))
        );
        
    });

    it("Upgrades to SA v2 and transfers ownership info from SA to the module", async () => {

        const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
        const SmartAccount = await ethers.getContractFactory("SmartAccount");
        const SmartAccountV1 = await ethers.getContractFactory("SmartAccountV1");
        
        // CREATE MODULE SETUP DATA AND DEPLOY ACCOUNT
        let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
            "initForSmartAccount",
            [walletOwnerAddress]
        );

        //change implementation calldata
        const updateImplCallData = SmartAccountV1.interface.encodeFunctionData(
            "updateImplementation",
            [baseImpl.address]
        );

        //setup and enable module calldata, uses eoaOwnershipSetupData
        const setupAndEnableModuleCallData = SmartAccount.interface.encodeFunctionData(
            "setupAndEnableModule",
            [
              eoaOwnersRegistryModule.address,
              eoaOwnershipSetupData
            ]
        );

        // UserOp calldata
        const executeBatchCallData = SmartAccount.interface.encodeFunctionData(
            "executeBatchCall",
            [
              [userSCW.address, userSCW.address],
              [ethers.utils.parseEther("0"),ethers.utils.parseEther("0")],
              [updateImplCallData, setupAndEnableModuleCallData]  
            ]
        );

        // Build and sign userOp
        const userOp1 = await fillAndSign(
            {
                sender: userSCW.address,
                callData: executeBatchCallData,
                callGasLimit: 1_000_000,
            },
            walletOwner,
            entryPoint,
            'nonce'
        );

        // Send userOp
        const handleOpsTxn = await entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
            gasLimit: 10000000,
          });
        await handleOpsTxn.wait();

        // check if module is set up and enabled
        expect(await userSCW.isModuleEnabled(eoaOwnersRegistryModule.address)).to.equal(true);
        expect(await eoaOwnersRegistryModule.smartAccountOwners(userSCW.address)).to.equal(walletOwnerAddress);
        
    });

    it("Can send native tokens and erc20 tokens to SA v2", async () => {

        const scwNativeBalanceBefore = await ethers.provider.getBalance(userSCW.address);
        const scwTokenBalanceBefore = await token.balanceOf(userSCW.address);
        
        // Attach v2 interface
        userSCW = await ethers.getContractAt(
            "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
            userSCW.address
        );

        // send eth to SA
        await accounts[0].sendTransaction({
            to: userSCW.address,
            value: ethers.utils.parseEther("10"),
        });

        // mint tokens to SA
        await token.mint(userSCW.address, ethers.utils.parseEther("1000000"));

        const expectedSCWNativeBalanceAfter = scwNativeBalanceBefore.add(ethers.utils.parseEther("10"));
        const expectedSCWTokenBalanceAfter = scwTokenBalanceBefore.add(ethers.utils.parseEther("1000000"));

        expect(await ethers.provider.getBalance(userSCW.address)).to.equal(expectedSCWNativeBalanceAfter);
        expect(await token.balanceOf(userSCW.address)).to.equal(expectedSCWTokenBalanceAfter);
        
    });

    it("Can execute userOp signed by the same owner from SA v2", async () => {

        const SmartAccount = await ethers.getContractFactory("SmartAccount");
        const charlieTokenBalanceBefore = await token.balanceOf(charlie);

        let tokenAmountToTransfer = ethers.utils.parseEther("0.5345");
        
        const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
            "executeCall",
            [
              token.address,
              ethers.utils.parseEther("0"),
              encodeTransfer(charlie, tokenAmountToTransfer.toString()),
            ]
          );
    
        const userOp1 = await fillAndSign(
            {
              sender: userSCW.address,
              callData: txnDataAA1,
              callGasLimit: 1_000_000,
            },
            walletOwner,
            entryPoint,
            'nonce'
        );

        // add validator module address to the signature
        let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
            ["bytes", "address"], 
            [userOp1.signature, eoaOwnersRegistryModule.address]
        );
        userOp1.signature = signatureWithModuleAddress;

        const handleOpsTxn = await entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
            gasLimit: 10000000,
        });
        await handleOpsTxn.wait();

        expect(await token.balanceOf(charlie)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
        
    });

  });
    
});