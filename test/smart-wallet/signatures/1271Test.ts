import { expect } from "chai";
import { ethers } from "hardhat";
import {
  SmartWallet,
  WalletFactory,
  EntryPoint,
  MockToken,
  MultiSend,
  StorageSetter,
  DefaultCallbackHandler,
  FakeSigner,
  SelfDestructingContract
} from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { encodeTransfer, encodeTransferFrom } from "../testUtils";
import {
  buildContractCall,
  MetaTransaction,
  SafeTransaction,
  Transaction,
  FeeRefund,
  executeTx,
  safeSignTypedData,
  buildContractSignature,
  safeSignMessage,
  buildSafeTransaction,
  executeContractCallWithSigners,
} from "../../../src/utils/execution";
import { buildMultiSendSafeTx } from "../../../src/utils/multisend";

describe("EIP-1271 Signatures Tests", function () {
  // TODO
  let baseImpl: SmartWallet;
  let walletFactory: WalletFactory;
  let entryPoint: EntryPoint;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let owner: string;
  let bob: string;
  let charlie: string;
  let hacker: string;
  let signerSmartAccount: any;
  let mainSmartAccount: any;
  let handler: DefaultCallbackHandler;
  const VERSION = '1.0.4'
  const create2FactoryAddress = "0xce0042B868300000d44A59004Da54A005ffdcf9f";
  let accounts: any;
  let fakeSigner: FakeSigner;
  let selfDestruct: SelfDestructingContract;
  let smartAccountInitialNativeTokenBalance: any;

  /* const domainType = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "verifyingContract", type: "address" },
    { name: "salt", type: "bytes32" },
  ]; */

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    const addresses = await ethers.provider.listAccounts();
    const ethersSigner = ethers.provider.getSigner();

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();
    hacker = await accounts[3].getAddress();
    // const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

    const BaseImplementation = await ethers.getContractFactory("SmartAccount");
    baseImpl = await BaseImplementation.deploy();
    await baseImpl.deployed();
    console.log("base wallet impl deployed at: ", baseImpl.address);

    const WalletFactory = await ethers.getContractFactory("SmartAccountFactory");
    walletFactory = await WalletFactory.deploy(baseImpl.address);
    await walletFactory.deployed();
    console.log("wallet factory deployed at: ", walletFactory.address);

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    entryPoint = await EntryPoint.deploy();
    await entryPoint.deployed();
    console.log("Entry point deployed at: ", entryPoint.address);

    const MockToken = await ethers.getContractFactory("MockToken");
    token = await MockToken.deploy();
    await token.deployed();
    console.log("Test token deployed at: ", token.address);

    const DefaultHandler = await ethers.getContractFactory(
      "DefaultCallbackHandler"
    );
    handler = await DefaultHandler.deploy();
    await handler.deployed();
    console.log("Default callback handler deployed at: ", handler.address);

    const Storage = await ethers.getContractFactory("StorageSetter");
    storage = await Storage.deploy();
    console.log("storage setter contract deployed at: ", storage.address);

    const MultiSend = await ethers.getContractFactory("MultiSend");
    multiSend = await MultiSend.deploy();
    console.log("Multisend helper contract deployed at: ", multiSend.address);

    console.log("mint tokens to owner address..");
    await token.mint(owner, ethers.utils.parseEther("1000000"));

    let deployWalletIndex = 0;

    console.log("Owner of Signer Smart Account is ", owner);

    // Deploy Signer Smart Account owned by Owner
    let signerSmartAccountAddress = await walletFactory.getAddressForCounterfactualWallet(owner, deployWalletIndex);
    
    await walletFactory.deployCounterFactualWallet(
        owner,
        entryPoint.address,
        handler.address,
        deployWalletIndex
    );

    signerSmartAccount = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      signerSmartAccountAddress
    );

    console.log("Signer smart account address %s %s", signerSmartAccountAddress, signerSmartAccount.address);

    // Deploy Main Smart Account owned by SignerSmartAccount
    let mainSmartAccountAddress = await walletFactory.getAddressForCounterfactualWallet(signerSmartAccountAddress, deployWalletIndex);
    
    await walletFactory.deployCounterFactualWallet(
      signerSmartAccountAddress,
      entryPoint.address,
      handler.address,
      0
    );

    mainSmartAccount = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      mainSmartAccountAddress
    );

    console.log("Main smart account address %s %s", mainSmartAccountAddress, mainSmartAccount.address);

    smartAccountInitialNativeTokenBalance = ethers.utils.parseEther("5");

    await accounts[1].sendTransaction({
      from: bob,
      to: signerSmartAccountAddress,
      value: smartAccountInitialNativeTokenBalance
    });

    await accounts[1].sendTransaction({
      from: bob,
      to: mainSmartAccountAddress,
      value: smartAccountInitialNativeTokenBalance
    });

  });

  it("Can execute tx with a valid 1271 signature", async function () {
    
    // transfer 100 tokens to Main Smart Account and Signer Smart Account
    await token
      .connect(accounts[0])
      .transfer(mainSmartAccount.address, ethers.utils.parseEther("100"));
    
    await token
      .connect(accounts[0])
      .transfer(signerSmartAccount.address, ethers.utils.parseEther("100"));

    let tokensToBeTransferred = ethers.utils.parseEther("10");

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, tokensToBeTransferred.toString()),
      nonce: await mainSmartAccount.getNonce(0),
    });

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

    const chainId = await mainSmartAccount.getChainId();

    // Build regular signature issued by owner
    // Try use signature directly on the contract
/*
    const { signer, data } = await safeSignTypedData(
      accounts[0], //owner
      signerSmartAccount,
      safeTx,
      chainId
    );

    let signature = "0x";
    signature += data.slice(2);

    await expect(
      signerSmartAccount.connect(accounts[1]).execTransaction(
        transaction,
        0, // batchId
        refundInfo,
        signature
      )
    ).to.emit(signerSmartAccount, "ExecutionSuccess");
*/

    // BUILD 1271 SIGNATURE BY SIGNER SMART ACCOUNT

    const { signer, data } = await safeSignTypedData(
      accounts[0], //owner
      mainSmartAccount,
      safeTx,
      chainId
    );
    
    let signature = buildContractSignature(signerSmartAccount.address, data);

    await expect(
      mainSmartAccount.connect(accounts[1]).execTransaction(
        transaction,
        0, // batchId
        refundInfo,
        signature
      )
    ).to.emit(mainSmartAccount, "ExecutionSuccess");
    

    expect(await token.balanceOf(charlie)).to.equal(
      tokensToBeTransferred
    );
    
  });

  
});
