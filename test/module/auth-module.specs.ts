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

    const AuthorizationModule = await ethers.getContractFactory(
      "AuthorizationModule"
    );
    authorizationModuleImplementation = await AuthorizationModule.connect(
      accounts[0]
    ).deploy();
    console.log(
      "AuthorizationModule deployed at ",
      authorizationModuleImplementation.address
    );

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
      // deploying wallet first
      await walletFactory.deployCounterFactualAccount(owner, 0);
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      const AuthorizationModule = await ethers.getContractFactory("AuthorizationModule");
      const initdata = AuthorizationModule.interface.encodeFunctionData(
        "initialize",
        [expectedSmartAccountAddress]
      );

      await moduleFactory.deployCounterFactualModule(authorizationModuleImplementation.address, initdata);
      const expectedModuleAddress = 
          await moduleFactory.getAddressForCounterFactualModule(authorizationModuleImplementation.address, initdata);
      
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

      console.log("user module at %s is for the account at %s", expectedModuleAddress, await userAuthorizationModule.smartAccount());

      expect(await userAuthorizationModule.smartAccount()).to.equal(expectedSmartAccountAddress);
      expect(await ethers.provider.getBalance(userSCW.address)).to.equal(ethers.utils.parseEther("10"));
      
    });

    it("When the module is not enabled, module txn signature validation goes as usual, but txn reverts by ModuleManager if tn was signed by owner", async () => {
      
      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const AuthorizationModule = await ethers.getContractFactory("AuthorizationModule");
      const charleTokenBalanceBefore = await token.balanceOf(charlie);

      // call Smart Account from  module to transfer tokens to charlie
      const txnDataCallWithSmartAccount = AuthorizationModule.interface.encodeFunctionData(
        "executeCallWithSmartAccount",
        [token.address, ethers.utils.parseEther("0"), encodeTransfer(charlie, ethers.utils.parseEther("10").toString())]
      );

      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          userAuthorizationModule.address,
          ethers.utils.parseEther("0"),
          txnDataCallWithSmartAccount,
        ]
      );

      const userOp1 = await fillAndSign(
        {
          sender: userSCW.address,
          callData: txnDataAA1,
          callGasLimit: 1_000_000,
        },
        accounts[0], // signed by an owner
        entryPoint,
        'nonce'
      );

      const hash = await entryPoint.getUserOpHash(userOp1);
      const ErrorAbi = ["function ModuleNotEnabled(address)"];      //encode custom error as it was a function
      const ErrorInterface = new ethers.utils.Interface(ErrorAbi);
      const expReturnData = ErrorInterface.encodeFunctionData("ModuleNotEnabled", [userAuthorizationModule.address]);
    
      const handleOpsTxn = await entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
        gasLimit: 10000000,
      });

      await expect(handleOpsTxn).to.emit(entryPoint, "UserOperationRevertReason").withArgs(
        hash,
        userOp1.sender,
        userOp1.nonce,
        expReturnData
      );

      expect(await token.balanceOf(charlie)).to.equal(charleTokenBalanceBefore);
      
    }); 

    it("When the module is not enabled, signature validation reverts with Module type of signature", async () => {
      
      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const AuthorizationModule = await ethers.getContractFactory("AuthorizationModule");
      const charleTokenBalanceBefore = await token.balanceOf(charlie);

      // call Smart Account from  module to transfer tokens to charlie
      const txnDataCallWithSmartAccount = AuthorizationModule.interface.encodeFunctionData(
        "executeCallWithSmartAccount",
        [token.address, ethers.utils.parseEther("0"), encodeTransfer(charlie, ethers.utils.parseEther("10").toString())]
      );

      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          userAuthorizationModule.address,
          ethers.utils.parseEther("0"),
          txnDataCallWithSmartAccount,
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
      userOp1.signature = moduleSignature;

      await expect(
        entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
          gasLimit: 10_000_000,
        })
      ).to.be.revertedWith('FailedOp(0, "AA23 reverted: ECDSA: invalid signature length")');

      expect(await token.balanceOf(charlie)).to.equal(charleTokenBalanceBefore);
      
    }); 

    it("Enables module and successfully executes userOp with the Module kind of signature", async () => {

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const AuthorizationModule = await ethers.getContractFactory("AuthorizationModule");
      const charleTokenBalanceBefore = await token.balanceOf(charlie);

      let tokenAmountToTransfer = ethers.utils.parseEther("10");
      
      //Enable module via self call
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "enableModule",
          [userAuthorizationModule.address],
          [accounts[0]]
        )
      ).to.emit(userSCW, "ExecutionSuccess");

      // call Smart Account from  module to transfer tokens to charlie
      const txnDataCallWithSmartAccount = AuthorizationModule.interface.encodeFunctionData(
        "executeCallWithSmartAccount",
        [token.address, ethers.utils.parseEther("0"), encodeTransfer(charlie, tokenAmountToTransfer.toString())]
      );

      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          userAuthorizationModule.address,
          ethers.utils.parseEther("0"),
          txnDataCallWithSmartAccount,
        ]
      );

      console.log("UserOp caldata = ", txnDataAA1);
      console.log("UserOp caldata + address ", txnDataAA1);

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
      userOp1.signature = moduleSignature;

      const handleOpsTxn = await entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
        gasLimit: 10000000,
      });

      await handleOpsTxn.wait();

      expect(await token.balanceOf(charlie)).to.equal(charleTokenBalanceBefore.add(tokenAmountToTransfer));
      
    });

    it("When the module is enabled, call to the module with a regular signature won't pass", async () => {

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const AuthorizationModule = await ethers.getContractFactory("AuthorizationModule");
      const charleTokenBalanceBefore = await token.balanceOf(charlie);

      let tokenAmountToTransfer = ethers.utils.parseEther("10");

      // Module is enabled at this point

      // call Smart Account from  module to transfer tokens to charlie
      const txnDataCallWithSmartAccount = AuthorizationModule.interface.encodeFunctionData(
        "executeCallWithSmartAccount",
        [token.address, ethers.utils.parseEther("0"), encodeTransfer(charlie, tokenAmountToTransfer.toString())]
      );

      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          userAuthorizationModule.address,
          ethers.utils.parseEther("0"),
          txnDataCallWithSmartAccount,
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

      await expect(
        entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
          gasLimit: 10_000_000,
        })
      ).to.be.revertedWith('FailedOp(0, "AA24 signature error")');

      expect(await token.balanceOf(charlie)).to.equal(charleTokenBalanceBefore);
      
    });

    it("When the module is enabled, but the owner is still EOA, not module call with not module signature will still pass", async () => {

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const AuthorizationModule = await ethers.getContractFactory("AuthorizationModule");
      const charleTokenBalanceBefore = await token.balanceOf(charlie);

      let tokenAmountToTransfer = ethers.utils.parseEther("10");

      // Module is enabled at this point
      expect(await userSCW.owner()).to.equal(accounts[0].address);

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

      let txnHandleOps = await
        entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
          gasLimit: 10_000_000,
        });
      await txnHandleOps.wait();

      expect(await token.balanceOf(charlie)).to.equal(charleTokenBalanceBefore.add(tokenAmountToTransfer.toString()));
      
    });

    it("When the module is enabled, and module is set as owner, not module call with not module signature won't pass", async () => {

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const AuthorizationModule = await ethers.getContractFactory("AuthorizationModule");
      const charleTokenBalanceBefore = await token.balanceOf(charlie);

      let tokenAmountToTransfer = ethers.utils.parseEther("10");

      // Module is enabled at this point
      let txnSetOwner = await userSCW.connect(accounts[0]).setOwner(userAuthorizationModule.address);
      await txnSetOwner.wait();
      expect(await userSCW.owner()).to.equal(userAuthorizationModule.address);

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

      await expect(
        entryPoint.handleOps([userOp1], await offchainSigner.getAddress(), {
          gasLimit: 10_000_000,
        })
      ).to.be.revertedWith('FailedOp(0, "AA24 signature error")');
      
      expect(await token.balanceOf(charlie)).to.equal(charleTokenBalanceBefore);
      
    });

    
  });
});
