import { expect } from "chai";
import { ethers } from "hardhat";
import {
  SmartAccount,
  SmartAccountFactory,
  EntryPoint,
  SocialRecoveryModule,
  WhitelistModule,
  EntryPoint__factory,
  VerifyingSingletonPaymaster,
  VerifyingSingletonPaymaster__factory,
  MockToken,
  MultiSend,
  StorageSetter,
  DefaultCallbackHandler,
  AuthorizationModule,
  ModuleFactory,
} from "../../typechain";
import {
  SafeTransaction,
  Transaction,
  FeeRefund,
  safeSignTypedData,
  buildSafeTransaction,
  executeContractCallWithSigners,
} from "../../src/utils/execution";
import { encodeTransfer } from "../smart-wallet/testUtils";
import { fillAndSign, fillUserOp } from "../utils/userOp";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";
import { Signer } from "ethers";
import { UserOperation } from "../utils/userOperation";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

export const AddressZero = "0x0000000000000000000000000000000000000000";
export const AddressOne = "0x0000000000000000000000000000000000000001";

async function getUserOpWithPaymasterData(
  paymaster: VerifyingSingletonPaymaster,
  smartAccountAddress: any,
  userOp: UserOperation,
  offchainPaymasterSigner: Signer,
  paymasterAddress: string,
  walletOwner: Signer,
  entryPoint: EntryPoint
) {
  const hash = await paymaster.getHash(
    userOp,
    await offchainPaymasterSigner.getAddress()
  );
  const sig = await offchainPaymasterSigner.signMessage(arrayify(hash));
  const userOpWithPaymasterData = await fillAndSign(
    {
      // eslint-disable-next-line node/no-unsupported-features/es-syntax
      ...userOp,
      paymasterAndData: hexConcat([
        paymasterAddress,
        ethers.utils.defaultAbiCoder.encode(
          ["address", "bytes"],
          [await offchainPaymasterSigner.getAddress(), sig]
        ),
      ]),
    },
    walletOwner,
    entryPoint,
    'nonce'
  );
  return userOpWithPaymasterData;
}

describe("Authorization Module tests", function () {
  let entryPoint: EntryPoint;
  let latestEntryPoint: EntryPoint;
  let walletOwner: Signer;
  let paymasterAddress: string;
  let offchainSigner: Signer, deployer: Signer;
  let offchainSigner2: Signer;
  let verifyingSingletonPaymaster: VerifyingSingletonPaymaster;
  let baseImpl: SmartAccount;
  let whitelistModule: WhitelistModule;
  let authorizationModuleImplementation: AuthorizationModule;
  let eoaOwnersRegistryModule: EOAOwnershipRegistryModule;
  let walletFactory: SmartAccountFactory;
  let moduleFactory: ModuleFactory;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let owner: string;
  let bob: string;
  let charlie: string;
  let newAuthority: string;
  let userSCW: any;
  let userAuthorizationModule: any;
  let accounts: any;
  let tx: any;

  before(async () => {
    accounts = await ethers.getSigners();
    entryPoint = await deployEntryPoint();

    deployer = accounts[0];
    offchainSigner = accounts[1];
    offchainSigner2 = accounts[3];
    walletOwner = deployer;

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();
    newAuthority = await accounts[3].getAddress();

    const offchainSignerAddress = await offchainSigner.getAddress();

    verifyingSingletonPaymaster =
      await new VerifyingSingletonPaymaster__factory(deployer).deploy(
        await deployer.getAddress(),
        entryPoint.address,
        offchainSignerAddress
      );

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

    const MockToken = await ethers.getContractFactory("MockToken");
    token = await MockToken.deploy();
    await token.deployed();
    console.log("Test token deployed at: ", token.address);

    const Storage = await ethers.getContractFactory("StorageSetter");
    storage = await Storage.deploy();
    console.log("storage setter contract deployed at: ", storage.address);

    const MultiSend = await ethers.getContractFactory("MultiSend");
    multiSend = await MultiSend.deploy();
    console.log("Multisend helper contract deployed at: ", multiSend.address);

    const WhitelistModule = await ethers.getContractFactory("WhitelistModule");
    whitelistModule = await WhitelistModule.deploy(bob);
    console.log("Test module deployed at ", whitelistModule.address);

    const AuthorizationModule = await ethers.getContractFactory("AuthorizationModule");
    authorizationModuleImplementation = await AuthorizationModule.connect(accounts[0]).deploy();
    console.log("AuthorizationModule deployed at ", authorizationModuleImplementation.address);

    const EOAOwnersModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
    eoaOwnersRegistryModule = await EOAOwnersModule.connect(accounts[0]).deploy();
    console.log("EOA Owners Registry Module deployed at ", eoaOwnersRegistryModule.address);

    const ModuleFactory = await ethers.getContractFactory(
      "ModuleFactory"
    );
    moduleFactory = await ModuleFactory.deploy();
    await moduleFactory.deployed();
    console.log("Module factory deployed at: ", moduleFactory.address);

    console.log("mint tokens to owner address..");
    await token.mint(owner, ethers.utils.parseEther("1000000"));

    paymasterAddress = verifyingSingletonPaymaster.address;
    console.log("Paymaster address is ", paymasterAddress);

    await verifyingSingletonPaymaster
      .connect(deployer)
      .addStake(10, { value: parseEther("2") });
    console.log("paymaster staked");

    await verifyingSingletonPaymaster.depositFor(
      await offchainSigner.getAddress(),
      { value: ethers.utils.parseEther("1") }
    );

    await entryPoint.depositTo(paymasterAddress, { value: parseEther("10") });
  });

  describe("Test Validation With Authorization Module", function () {
    it("Deploys user Smart Account and Module", async () => {

      // CREATE MODULE INIT DATA AND CHECK ADDRESS
      const AuthorizationModule = await ethers.getContractFactory("AuthorizationModule");
      const sigLengthRequired = 16;
      
      const moduleInitData = AuthorizationModule.interface.encodeFunctionData(
        "initialize",
        [sigLengthRequired]
      );

      const expectedModuleAddress = 
          await moduleFactory.getAddressForCounterFactualModule(authorizationModuleImplementation.address, moduleInitData);

      // CREATE MODULE SETUP DATA AND DEPLOY ACCOUNT

      const ModuleFactory = await ethers.getContractFactory("ModuleFactory");
      const moduleSetupData = ModuleFactory.interface.encodeFunctionData(
        "deployCounterFactualModule",
        [authorizationModuleImplementation.address, moduleInitData]
      );

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(moduleFactory.address, moduleSetupData, 0);

      let smartAccountDeployTx = await walletFactory.deployCounterFactualAccount(moduleFactory.address, moduleSetupData, 0);
      expect(smartAccountDeployTx).to.emit(walletFactory, "AccountCreation")
        .withArgs(expectedSmartAccountAddress, expectedModuleAddress, 0);

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );
      
      // module should have been deployed in course of smart account deployment
      userAuthorizationModule = await ethers.getContractAt(
        "contracts/smart-contract-wallet/test/AuthorizationModules/AuthorizationModule.sol:AuthorizationModule",
        expectedModuleAddress
      );

      await accounts[0].sendTransaction({
        to: userSCW.address,
        value: ethers.utils.parseEther("10"),
      });

      console.log("mint tokens to userSCW address..");
      await token.mint(userSCW.address, ethers.utils.parseEther("1000000"));

      console.log("user module is at %s", expectedModuleAddress);

      expect(await userAuthorizationModule.SIG_LENGTH_REQUIRED()).to.equal(sigLengthRequired);
      expect(await userSCW.isModuleEnabled(userAuthorizationModule.address)).to.equal(true);
      expect(await ethers.provider.getBalance(userSCW.address)).to.equal(ethers.utils.parseEther("10"));
      
    });

    it("Successfully executes userOp with the Example Auth Module kind of signature", async () => {

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const AuthorizationModule = await ethers.getContractFactory("AuthorizationModule");
      const charleTokenBalanceBefore = await token.balanceOf(charlie);
      const EIP1271_MAGIC_VALUE = "0x1626ba7e";

      let tokenAmountToTransfer = ethers.utils.parseEther("10");

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
        accounts[0], 
        entryPoint,
        'nonce'
      );

      let moduleSignature = "0x12345678123456781234567812345678";
      expect(moduleSignature.slice(2).length).to.equal(32); //expected by Module
      let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(["bytes", "address"], [moduleSignature, userAuthorizationModule.address]);
      console.log("signatureWithModuleAddress: ", signatureWithModuleAddress);

      userOp1.signature = signatureWithModuleAddress;
      let userOp1Hash = await entryPoint.getUserOpHash(userOp1);

      const handleOpsTxn = await entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
        gasLimit: 10000000,
      });

      await handleOpsTxn.wait();

      expect(await token.balanceOf(charlie)).to.equal(charleTokenBalanceBefore.add(tokenAmountToTransfer));

      expect(await userSCW.isValidSignature(userOp1Hash, signatureWithModuleAddress)).to.equal(EIP1271_MAGIC_VALUE);
      
    });

    it("Can setup and enable registry module", async () => {

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      
      let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [accounts[0].address]
      );

      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "setupAndEnableModule",
        [
          eoaOwnersRegistryModule.address,
          eoaOwnershipSetupData
        ]
      );

      const userOp1 = await fillAndSign(
        {
          sender: userSCW.address,
          callData: txnDataAA1,
          callGasLimit: 1_000_000,
        },
        accounts[0], 
        entryPoint,
        'nonce'
      );

      let moduleSignature = "0x12345678123456781234567812345678";
      expect(moduleSignature.slice(2).length).to.equal(32); //expected by Module
      let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(["bytes", "address"], [moduleSignature, userAuthorizationModule.address]);
      userOp1.signature = signatureWithModuleAddress;

      const handleOpsTxn = await entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
        gasLimit: 10000000,
      });
      await handleOpsTxn.wait();

      expect(await eoaOwnersRegistryModule.smartAccountOwners(userSCW.address)).to.equal(accounts[0].address);
      expect(await userSCW.isModuleEnabled(eoaOwnersRegistryModule.address)).to.equal(true);
      
    });

    it("Can send a userOp signed for the newly connected module", async () => {

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const charlieTokenBalanceBefore = await token.balanceOf(charlie);
      const EIP1271_MAGIC_VALUE = "0x1626ba7e";

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
        accounts[0],  //signed by owner, that is set in the EOAOwnershipRegistryModule
        entryPoint,
        'nonce'
      );

      // add validator module address to the signature
      let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"], 
        [userOp1.signature, eoaOwnersRegistryModule.address]
      );
      userOp1.signature = signatureWithModuleAddress;

      let userOp1Hash = await entryPoint.getUserOpHash(userOp1);

      const handleOpsTxn = await entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
        gasLimit: 10000000,
      });
      await handleOpsTxn.wait();

      expect(await token.balanceOf(charlie)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
      
      expect(await userSCW.isValidSignature(userOp1Hash, signatureWithModuleAddress)).to.equal(EIP1271_MAGIC_VALUE);
    });

    
    
  });
});
