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
  SelfDestructingContract,
} from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { encodeTransfer, encodeTransferFrom } from "./testUtils";
import {
  buildContractCall,
  MetaTransaction,
  SafeTransaction,
  Transaction,
  FeeRefund,
  executeTx,
  safeSignTypedData,
  safeSignMessage,
  buildSafeTransaction,
  executeContractCallWithSigners,
  EOA_CONTROLLED_FLOW,
} from "../../src/utils/execution";
import { buildMultiSendSafeTx } from "../../src/utils/multisend";

describe("Optimized function name tests for gas estimation", function () {
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
  let userSCW: any;
  let handler: DefaultCallbackHandler;
  const VERSION = "1.0.0";
  const create2FactoryAddress = "0xce0042B868300000d44A59004Da54A005ffdcf9f";
  let accounts: any;
  let fakeSigner: FakeSigner;
  let selfDestruct: SelfDestructingContract;
  let scwNativeTokenBalance: any;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    const addresses = await ethers.provider.listAccounts();
    const ethersSigner = ethers.provider.getSigner();

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();
    hacker = await accounts[3].getAddress();
    // const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    entryPoint = await EntryPoint.deploy();
    await entryPoint.deployed();
    console.log("Entry point deployed at: ", entryPoint.address);

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

    console.log("mint tokens to owner address..");
    await token.mint(owner, ethers.utils.parseEther("1000000"));

    const expected = await walletFactory.getAddressForCounterFactualAccount(
      owner,
      0
    );
    await expect(walletFactory.deployCounterFactualAccount(owner, 0))
      .to.emit(walletFactory, "AccountCreation")
      .withArgs(expected, owner, 0);

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      expected
    );

    scwNativeTokenBalance = ethers.utils.parseEther("5");

    await accounts[1].sendTransaction({
      from: bob,
      to: expected,
      value: scwNativeTokenBalance,
    });
  });

  it("call optimized function name", async function () {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: await userSCW.getNonce(EOA_CONTROLLED_FLOW),
    });

    const chainId = await userSCW.getChainId();
    const { signer, data } = await safeSignTypedData(
      accounts[0],
      userSCW,
      safeTx,
      chainId
    );

    console.log(safeTx);

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

    await expect(
      userSCW
        .connect(accounts[0])
        .execTransaction_S6W(transaction, refundInfo, signature)
    ).to.emit(userSCW, "ExecutionSuccess");

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );
  });

  it("call regular function name", async function () {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: await userSCW.getNonce(EOA_CONTROLLED_FLOW),
    });

    const chainId = await userSCW.getChainId();
    const { signer, data } = await safeSignTypedData(
      accounts[0],
      userSCW,
      safeTx,
      chainId
    );

    console.log(safeTx);

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

    await expect(
      userSCW
        .connect(accounts[0])
        .execTransaction(transaction, refundInfo, signature)
    ).to.emit(userSCW, "ExecutionSuccess");

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );
  });

});
