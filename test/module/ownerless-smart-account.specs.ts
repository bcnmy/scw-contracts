import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
  SmartAccount,
  SmartAccountFactory,
  MockToken,
  EcdsaOwnershipRegistryModule,
} from "../../typechain";
import {
  SafeTransaction,
  Transaction,
  FeeRefund,
  safeSignTypedData,
  buildSafeTransaction,
} from "../../src/utils/execution";
import { encodeTransfer } from "../smart-wallet/testUtils";
import { fillAndSign } from "../utils/userOp";
import { arrayify } from "ethers/lib/utils";
import { Signer } from "ethers";
import { EntryPoint } from "@account-abstraction/contracts/core/EntryPoint.sol";
export const AddressZero = "0x0000000000000000000000000000000000000000";
export const AddressOne = "0x0000000000000000000000000000000000000001";


describe("Ownerless SA Basics", function () {
  let entryPoint: EntryPoint;
  let walletOwner: Signer;
  let offchainSigner: Signer, deployer: Signer;
  let offchainSigner2: Signer;
  let baseImpl: SmartAccount;
  let eoaOwnersRegistryModule: EcdsaOwnershipRegistryModule;
  let walletFactory: SmartAccountFactory;
  let token: MockToken;
  let owner: string;
  let bob: string;
  let charlie: string;
  let newAuthority: string;
  let userSCW: any;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();

    deployer = accounts[0];
    offchainSigner = accounts[1];
    offchainSigner2 = accounts[3];
    walletOwner = deployer;

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();
    newAuthority = await accounts[3].getAddress();

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    entryPoint = await EntryPoint.deploy();
    await entryPoint.deployed();
    console.log("EntryPoint deployed at: ", entryPoint.address);

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

    const EOAOwnersModule = await ethers.getContractFactory("EcdsaOwnershipRegistryModule");
    eoaOwnersRegistryModule = await EOAOwnersModule.connect(accounts[0]).deploy();
    console.log("EOA Owners Registry Module deployed at ", eoaOwnersRegistryModule.address);

    console.log("mint tokens to owner address..");
    await token.mint(owner, ethers.utils.parseEther("1000000"));

  });

  describe("Deploy and Perform Actions", function () {
    it("Deploys Ownerless Smart Account and Default Validation Module", async () => {

      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory("EcdsaOwnershipRegistryModule");
      const eoaOwner = await accounts[1].getAddress();
      
      // CREATE MODULE SETUP DATA AND DEPLOY ACCOUNT
      let ecdsaOwnershipSetupData = EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [eoaOwner]
      );

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(eoaOwnersRegistryModule.address, ecdsaOwnershipSetupData, 0);

      let smartAccountDeployTx = await walletFactory.deployCounterFactualAccount(eoaOwnersRegistryModule.address, ecdsaOwnershipSetupData, 0);
      expect(smartAccountDeployTx).to.emit(walletFactory, "AccountCreation")
        .withArgs(expectedSmartAccountAddress, eoaOwnersRegistryModule.address, 0);

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      //
      await accounts[0].sendTransaction({
        to: userSCW.address,
        value: ethers.utils.parseEther("10"),
      });

      console.log("mint tokens to userSCW address..");
      await token.mint(userSCW.address, ethers.utils.parseEther("1000000"));

      console.log("user module is at %s", eoaOwnersRegistryModule.address);

      expect(await userSCW.isModuleEnabled(eoaOwnersRegistryModule.address)).to.equal(true);
      expect(await eoaOwnersRegistryModule.getOwner(userSCW.address)).to.equal(eoaOwner);

      expect(await ethers.provider.getBalance(userSCW.address)).to.equal(ethers.utils.parseEther("10"));
      expect(await token.balanceOf(userSCW.address)).to.equal(ethers.utils.parseEther("1000000"));
      
    });


    it("Can send a userOp with a default validation module", async () => {

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const charlieTokenBalanceBefore = await token.balanceOf(charlie);
      const EIP1271_MAGIC_VALUE = "0x1626ba7e";

      const eoaOwner = await eoaOwnersRegistryModule.getOwner(userSCW.address);
      expect(eoaOwner).to.equal(await accounts[1].getAddress());

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
        accounts[1],  //signed by owner, that is set in the EcdsaOwnershipRegistryModule
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
      
      // we sign userOpHash with signer.signMessage, which adds a prefix to the message
      // so we need to use 'ethers.utils.hashMessage' to get the same hash,
      // as isValidSignature expects the prefixed message hash (it doesn't prefix it itself)
      let userOp1Hash = await entryPoint.getUserOpHash(userOp1);
      const message = arrayify(userOp1Hash);
      const ethSignedUserOpHash = ethers.utils.hashMessage(message);

      expect(await userSCW.isValidSignature(ethSignedUserOpHash, signatureWithModuleAddress)).to.equal(EIP1271_MAGIC_VALUE);
    });

    it("Can use forward flow with modules", async () => {

      const EOA_CONTROLLED_FLOW = 1;
      const charlieTokenBalanceBefore = await token.balanceOf(charlie);

      let tokenAmountToTransfer = ethers.utils.parseEther("0.13924");

      const safeTx: SafeTransaction = buildSafeTransaction({
        to: token.address,
        data: encodeTransfer(charlie, tokenAmountToTransfer.toString()),
        nonce: await userSCW.getNonce(EOA_CONTROLLED_FLOW),
      });
  
      const chainId = await userSCW.getChainId();
      const { signer, data } = await safeSignTypedData(
        accounts[1], //eoa owner stored in the registry
        userSCW,
        safeTx,
        chainId
      );

      const transaction: Transaction = {
        to: safeTx.to,
        value: safeTx.value,
        data: safeTx.data,
        operation: safeTx.operation,
        targetTxGas: safeTx.targetTxGas,
      };
      const refundInfo: FeeRefund = {
        baseGas: safeTx.baseGas,
        gasPrice: safeTx.gasPrice,
        tokenGasPriceFactor: safeTx.tokenGasPriceFactor,
        gasToken: safeTx.gasToken,
        refundReceiver: safeTx.refundReceiver,
      };
  
      let signature = "0x";
      signature += data.slice(2);
      // add validator module address to the signature
      let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"], 
        [signature, eoaOwnersRegistryModule.address]
      );
  
      await expect(
        userSCW
          .connect(accounts[0])
          .execTransaction_S6W(transaction, refundInfo, signatureWithModuleAddress)
      ).to.emit(userSCW, "ExecutionSuccess");

      expect(await token.balanceOf(charlie)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
      
    });

  });
});
