 import { expect } from "chai";
import { ethers } from "hardhat";
import {
  SmartAccount,
  SmartAccountFactory,
  EntryPoint__factory,
  EntryPoint,
  MockToken,
  MultiSend,
  StorageSetter,
  DefaultCallbackHandler,
} from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { encodeTransfer, encodeTransferFrom } from "../smart-wallet/testUtils";
import {
  SafeTransaction,
  Transaction,
  FeeRefund,
  safeSignTypedData,
  buildSafeTransaction,
  executeContractCallWithSigners,
} from "../../src/utils/execution";
import { buildMultiSendSafeTx } from "../../src/utils/multisend";
import { deployContract } from "../utils/setupHelper";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

describe("Upgrade to enable Guards", function () {
  // TODO
  let baseImpl: SmartAccount;
  let walletFactory: SmartAccountFactory;
  let entryPoint: EntryPoint;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let owner: string;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  // let handler: DefaultCallbackHandler;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();
    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    entryPoint = await EntryPoint.deploy();
    await entryPoint.deployed();

    const BaseImplementation = await ethers.getContractFactory("SmartAccount");
    baseImpl = await BaseImplementation.deploy(entryPoint.address);
    await baseImpl.deployed();

    const WalletFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    walletFactory = await WalletFactory.deploy(baseImpl.address);
    await walletFactory.deployed();

    const MockToken = await ethers.getContractFactory("MockToken");
    token = await MockToken.deploy();
    await token.deployed();

    const Storage = await ethers.getContractFactory("StorageSetter");
    storage = await Storage.deploy();

    const MultiSend = await ethers.getContractFactory("MultiSend");
    multiSend = await MultiSend.deploy();

    await token.mint(owner, ethers.utils.parseEther("1000000"));
  });

  it("Should deploy a wallet and validate entrypoint", async function () {
    const expected = await walletFactory.getAddressForCounterFactualAccount(
      owner,
      0
    );
    console.log("deploying new wallet..expected address: ", expected);

    await expect(walletFactory.deployCounterFactualAccount(owner, 0))
      .to.emit(walletFactory, "AccountCreation")
      .withArgs(expected, owner, 0);

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      expected
    );

    const entryPointAddress = await userSCW.entryPoint();
    expect(entryPointAddress).to.equal(entryPoint.address);

    await accounts[1].sendTransaction({
      from: bob,
      to: expected,
      value: ethers.utils.parseEther("5"),
    });
  });

  it("Should deploy new implementation and upgrade", async function () {

    const BaseImplementation12 = await ethers.getContractFactory(
      "SmartAccount12Guard"
    );
    const baseImpl12 = await BaseImplementation12.deploy(entryPoint.address);
    await baseImpl12.deployed();
    console.log("Upgraded Smart Account deployed at: ", baseImpl12.address);

    await expect(
      userSCW.connect(accounts[0]).updateImplementation(baseImpl12.address)
    ).to.emit(userSCW, "ImplementationUpdated").withArgs(baseImpl.address, baseImpl12.address);

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/test/upgrades/SmartAccount12Guard.sol:SmartAccount12Guard",
      userSCW.address
    );
    
  });

  it("should send a single transacton (EIP712 sign) with upgraded implementation", async function () {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const amountToTransfer = ethers.utils.parseEther("10");
    const balanceCharlieBefore = await token.balanceOf(charlie);
      
    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, amountToTransfer.toString()),
      nonce: await userSCW.getNonce(1),
    });

    const chainId = await userSCW.getChainId();
    const { signer, data } = await safeSignTypedData(
      accounts[0],
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
    await expect(
      userSCW
        .connect(accounts[0])
        .execTransaction_S6W(transaction, refundInfo, signature)
    ).to.emit(userSCW, "ExecutionSuccess");

    expect(await token.balanceOf(charlie)).to.equal(
      balanceCharlieBefore.add(amountToTransfer)
    );
  });

  it("should deploy and connect the guard", async function () {

    const IncrNonceLib = await ethers.getContractFactory("TestIncreaseNonceLib");
    const trustedTarget = await IncrNonceLib.deploy();
    await trustedTarget.deployed();

    const DelegateCallGuard = await ethers.getContractFactory(
      "DelegateCallTransactionGuard"
    );
    const dcGuard = await DelegateCallGuard.deploy(trustedTarget.address);
    await dcGuard.deployed();
    console.log("Delegate Call Guard deployed to: ", dcGuard.address);

    await expect(
      executeContractCallWithSigners(
        userSCW,
        userSCW,
        "setGuard",
        [dcGuard.address],
        [accounts[0]]
      )
    ).to.emit(userSCW, "ExecutionSuccess");

    expect(await userSCW.getGuard()).to.equal(dcGuard.address);dcGuard.address

  });

  it("should still allow calls (not delegatecalls) thru the guard", async function () {

    const IncrNonceLib = await ethers.getContractFactory("TestIncreaseNonceLib");
    const trustedTarget = await IncrNonceLib.deploy();
    await trustedTarget.deployed();

    const DelegateCallGuard = await ethers.getContractFactory(
      "DelegateCallTransactionGuard"
    );
    const dcGuard = await DelegateCallGuard.deploy(trustedTarget.address);
    await dcGuard.deployed();

    await executeContractCallWithSigners(userSCW,userSCW,"setGuard",[dcGuard.address],[accounts[0]]);
    
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const amountToTransfer = ethers.utils.parseEther("10");
    const balanceCharlieBefore = await token.balanceOf(charlie);

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, amountToTransfer.toString()),
      nonce: await userSCW.getNonce(1),
    });

    const chainId = await userSCW.getChainId();
    const { signer, data } = await safeSignTypedData(
      accounts[0],
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
    await expect(
      userSCW
        .connect(accounts[0])
        .execTransaction_S6W(transaction, refundInfo, signature)
    ).to.emit(userSCW, "ExecutionSuccess");

    expect(await token.balanceOf(charlie)).to.equal(
      balanceCharlieBefore.add(amountToTransfer)
    );

  });

  it("Should revert for delegatecall to unapproved contract", async function () {

    const IncrNonceLib = await ethers.getContractFactory("TestIncreaseNonceLib");
    const trustedTarget = await IncrNonceLib.deploy();
    await trustedTarget.deployed();

    const nonTrustedTarget = await IncrNonceLib.deploy();
    await nonTrustedTarget.deployed();

    const DelegateCallGuard = await ethers.getContractFactory(
      "DelegateCallTransactionGuard"
    );
    const dcGuard = await DelegateCallGuard.deploy(trustedTarget.address);
    await dcGuard.deployed();

    await executeContractCallWithSigners(userSCW, userSCW, "setGuard",[dcGuard.address], [accounts[0]]);

    const delegateCall = 1;

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: nonTrustedTarget.address,
      operation: delegateCall,
      data: nonTrustedTarget.interface.encodeFunctionData("increaseNonce", [2]),
      nonce: await userSCW.getNonce(1),
    });

    const chainId = await userSCW.getChainId();
    const { signer, data } = await safeSignTypedData(
      accounts[0],
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

    await expect(
      userSCW
        .connect(accounts[0])
        .execTransaction_S6W(transaction, refundInfo, signature)
    ).to.be.revertedWith("DelegateCallGuardRestricted");

  });

  it("Should allow delegatecall to approved contract", async function () {

    const IncrNonceLib = await ethers.getContractFactory("TestIncreaseNonceLib");
    const trustedTarget = await IncrNonceLib.deploy();
    await trustedTarget.deployed();

    const nonTrustedTarget = await IncrNonceLib.deploy();
    await nonTrustedTarget.deployed();

    const DelegateCallGuard = await ethers.getContractFactory(
      "DelegateCallTransactionGuard"
    );
    const dcGuard = await DelegateCallGuard.deploy(trustedTarget.address);
    await dcGuard.deployed();

    await executeContractCallWithSigners(userSCW, userSCW, "setGuard",[dcGuard.address], [accounts[0]]);

    const delegateCall = 1;
    const testBatchId = 2;
    const nonceBefore = await userSCW.nonces(testBatchId);

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: trustedTarget.address,
      operation: delegateCall,
      data: nonTrustedTarget.interface.encodeFunctionData("increaseNonce", [testBatchId]),
      nonce: await userSCW.getNonce(1),
    });

    const chainId = await userSCW.getChainId();
    const { signer, data } = await safeSignTypedData(
      accounts[0],
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

    await
      userSCW
        .connect(accounts[0])
        .execTransaction_S6W(transaction, refundInfo, signature);

    expect(await userSCW.nonces(testBatchId)).to.equal(nonceBefore.add(1));

  });

  
});
