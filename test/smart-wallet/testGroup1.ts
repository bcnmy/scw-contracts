import { expect } from "chai";
import { ethers } from "hardhat";
import {
  SmartAccount,
  SmartAccountFactory,
  EntryPoint,
  MockToken,
  MultiSend,
  StorageSetter,
  SocialRecoveryModule,
  WhitelistModule,
  DefaultCallbackHandler,
} from "../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { encodeTransfer, encodeTransferFrom } from "./testUtils";
import {
  buildContractCall,
  MetaTransaction,
  SafeTransaction,
  Transaction,
  FeeRefund,
  safeSignTypedData,
  safeSignMessage,
  buildSafeTransaction,
  executeContractCallWithSigners,
  EOA_CONTROLLED_FLOW,
} from "../../src/utils/execution";
import { buildMultiSendSafeTx } from "../../src/utils/multisend";

describe("Base Wallet Functionality", function () {
  // TODO
  let baseImpl: SmartAccount;
  let walletFactory: SmartAccountFactory;
  let entryPoint: EntryPoint;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let socialRecoveryModule: SocialRecoveryModule;
  let owner: string;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  // let handler: DefaultCallbackHandler;
  let accounts: any;

  /* const domainType = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "verifyingContract", type: "address" },
    { name: "salt", type: "bytes32" },
  ]; */

  beforeEach(async () => {
    accounts = await ethers.getSigners();

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();
    // const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    entryPoint = await EntryPoint.deploy();
    await entryPoint.deployed();
    console.log("Entry point deployed at: ", entryPoint.address);

    /* const DefaultHandler = await ethers.getContractFactory(
      "DefaultCallbackHandler"
    );
    handler = await DefaultHandler.deploy();
    await handler.deployed();
    console.log("Default callback handler deployed at: ", handler.address); */

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
  });

  // describe("Wallet initialization", function () {
  it("Should set the correct states on proxy", async function () {
    const indexForSalt = 0;
    const expected = await walletFactory.getAddressForCounterFactualAccount(
      owner,
      indexForSalt
    );
    console.log("deploying new wallet..expected address: ", expected);

    await expect(walletFactory.deployCounterFactualAccount(owner, indexForSalt))
      .to.emit(walletFactory, "AccountCreation")
      .withArgs(expected, owner, indexForSalt);

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      expected
    );

    const entryPointAddress = await userSCW.entryPoint();
    expect(entryPointAddress).to.equal(entryPoint.address);

    const walletOwner = await userSCW.owner();
    expect(walletOwner).to.equal(owner);

    const walletNonce1 = await userSCW.nonce();
    const walletNonce2 = await userSCW.getNonce(EOA_CONTROLLED_FLOW);
    const chainId = await userSCW.getChainId();

    console.log("walletNonce AA flow ", walletNonce1);
    console.log("walletNonce EOA flow ", walletNonce2);
    console.log("chainId ", chainId);

    const tx = await accounts[1].sendTransaction({
      from: bob,
      to: expected,
      value: ethers.utils.parseEther("5"),
    });

    await expect(tx)
      .to.emit(userSCW, "SmartAccountReceivedNativeToken")
      .withArgs(bob, ethers.utils.parseEther("5"));
  });

  it("can enable modules and accept transactions from it", async function () {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const WhitelistModule = await ethers.getContractFactory("WhitelistModule");
    const whitelistModule: WhitelistModule = await WhitelistModule.deploy(bob);
    console.log("Test module deployed at ", whitelistModule.address);

    // whitelisting target contract
    await whitelistModule
      .connect(accounts[1])
      .whitelistDestination(token.address);

    // Owner itself can not directly add modules
    await expect(
      userSCW.connect(accounts[0]).enableModule(whitelistModule.address)
    ).to.be.reverted;

    // Without enabling module one can't send transactions
    // invoking wallet from module without enabling it!
    await expect(
      whitelistModule
        .connect(accounts[2])
        .authCall(
          userSCW.address,
          token.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie, ethers.utils.parseEther("10").toString())
        )
    ).to.be.reverted;

    // Modules can only be enabled via safe transaction
    await expect(
      executeContractCallWithSigners(
        userSCW,
        userSCW,
        "enableModule",
        [whitelistModule.address],
        [accounts[0]]
      )
    ).to.emit(userSCW, "ExecutionSuccess");

    // TODO
    // have to write a test to disable a module

    // invoking module!
    await whitelistModule
      .connect(accounts[2])
      .authCall(
        userSCW.address,
        token.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie, ethers.utils.parseEther("10").toString())
      );

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );
  });

  // Transactions
  it("Should send basic erc20 transactions from SCW to external contracts", async function () {
    console.log("sending tokens to the safe..");
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    // test for executeCall method with erc20 transfer
    const data = encodeTransfer(bob, ethers.utils.parseEther("10").toString());
    let tx = await userSCW
      .connect(accounts[0])
      .executeCall_s1m(token.address, ethers.utils.parseEther("0"), data);
    await tx.wait();
    expect(await token.balanceOf(bob)).to.equal(ethers.utils.parseEther("10"));

    // test for executeBatchCall method with erc20 transfer
    const data2 = encodeTransfer(
      charlie,
      ethers.utils.parseEther("10").toString()
    );
    tx = await userSCW
      .connect(accounts[0])
      .executeBatchCall_4by(
        [token.address, token.address],
        [0, 0],
        [data, data2]
      );
    await tx.wait();

    expect(await token.balanceOf(bob)).to.equal(ethers.utils.parseEther("20"));
    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );
  });

  it("Should send basic native eth transactions from SCW to external contracts", async function () {
    console.log("sending native tokens to bob charlie..");

    // test for executeCall method with native value transfer
    const bobBalBefore = await ethers.provider.getBalance(bob);
    let tx = await userSCW
      .connect(accounts[0])
      .executeCall_s1m(bob, ethers.utils.parseEther("1"), "0x");
    await tx.wait();
    expect(await ethers.provider.getBalance(bob)).to.equal(
      bobBalBefore.add(ethers.utils.parseEther("1"))
    );

    // executeBatchCall method with native value transfer
    const charlieBalBefore = await ethers.provider.getBalance(charlie);
    tx = await userSCW
      .connect(accounts[0])
      .executeBatchCall_4by(
        [bob, charlie],
        [ethers.utils.parseEther("1"), ethers.utils.parseEther("1")],
        ["0x", "0x"]
      );
    await tx.wait();
    expect(await ethers.provider.getBalance(bob)).to.equal(
      bobBalBefore.add(ethers.utils.parseEther("2"))
    );
    expect(await ethers.provider.getBalance(charlie)).to.equal(
      charlieBalBefore.add(ethers.utils.parseEther("1"))
    );

    // test with empty array data and value
    tx = userSCW.connect(accounts[0]).executeBatchCall_4by([], [], []);
    expect(tx).to.be.revertedWith("WrongBatchProvided");
  });

  it("should send transactions in a batch", async function () {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const txs: MetaTransaction[] = [
      buildSafeTransaction({
        to: bob,
        value: ethers.utils.parseEther("1"),
        nonce: 0, // doesn't matter
      }),
      buildSafeTransaction({
        to: charlie,
        value: ethers.utils.parseEther("0.1"),
        nonce: 0, // doesn't matter
      }),
      buildContractCall(
        token,
        "transfer",
        [bob, ethers.utils.parseEther("10")],
        0
      ),
      buildSafeTransaction({
        to: token.address,
        // value: ethers.utils.parseEther("1"),
        data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
        nonce: 0, // doesn't matter
      }),
      buildContractCall(storage, "setStorage", ["0xbaddad"], 0), // nonce here doesn't matter
      buildContractCall(storage, "setStorage", ["0xbaddad"], 0, true), // delegateCall
    ];
    // console.log(txs);
    const safeTx: SafeTransaction = buildMultiSendSafeTx(
      multiSend,
      txs,
      await userSCW.getNonce(EOA_CONTROLLED_FLOW)
    );
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

    await expect(
      await ethers.provider.getStorageAt(
        userSCW.address,
        "0x4242424242424242424242424242424242424242424242424242424242424242"
      )
    ).to.be.eq("0x" + "baddad".padEnd(64, "0"));

    await expect(
      await ethers.provider.getStorageAt(
        storage.address,
        "0x4242424242424242424242424242424242424242424242424242424242424242"
      )
    ).to.be.eq("0x" + "baddad".padEnd(64, "0"));

    expect(await token.balanceOf(bob)).to.equal(ethers.utils.parseEther("10"));
    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );
  });

  it("should send a single transacton (EIP712 sign)", async function () {
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

  it("Can not execute txn with the wrong nonce", async function () {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const wrongNonce = (await userSCW.getNonce(EOA_CONTROLLED_FLOW)).add(1);

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: wrongNonce,
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
    ).to.be.reverted;

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("0")
    );
  });

  it("Can not execute txn with the same nonce twice", async function () {
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

    await expect(
      userSCW
        .connect(accounts[0])
        .execTransaction_S6W(transaction, refundInfo, signature)
    ).to.be.reverted;

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );
  });

  it("should send two consecutive transactions with the correct nonces and they go through)", async function () {
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
    let { signer, data } = await safeSignTypedData(
      accounts[0],
      userSCW,
      safeTx,
      chainId
    );

    // console.log(safeTx);

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

    const safeTx2: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("11").toString()),
      nonce: await userSCW.getNonce(EOA_CONTROLLED_FLOW),
    });

    ({ signer, data } = await safeSignTypedData(
      accounts[0],
      userSCW,
      safeTx2,
      chainId
    ));

    const transaction2: Transaction = {
      to: safeTx2.to,
      value: safeTx2.value,
      data: safeTx2.data,
      operation: safeTx2.operation,
      targetTxGas: safeTx2.targetTxGas,
    };

    signature = "0x";
    signature += data.slice(2);

    await expect(
      userSCW
        .connect(accounts[0])
        .execTransaction_S6W(transaction2, refundInfo, signature)
    ).to.emit(userSCW, "ExecutionSuccess");

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("21")
    );
  });

  it("should send a single transacton (personal sign)", async function () {
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
    const { signer, data } = await safeSignMessage(
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

  // Work in progress!
  // transactions from modules -> Done
  // execTransaction_S6W from relayer - personal Sign + EIP712 sign (without refund) -> Done
  // above with refund in eth and in erc20 [ Need gas estimation utils! #Review] -> Done

  it("can send transactions and charge smart account for fees in native tokens", async function () {
    const balanceBefore = await ethers.provider.getBalance(bob);
    console.log(balanceBefore.toString());

    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: await userSCW.getNonce(EOA_CONTROLLED_FLOW),
    });

    const gasEstimate1 = await ethers.provider.estimateGas({
      to: token.address,
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      from: userSCW.address,
    });

    // console.log(gasEstimate1.toNumber());

    const chainId = await userSCW.getChainId();

    safeTx.refundReceiver = "0x0000000000000000000000000000000000000000";
    safeTx.gasToken = "0x0000000000000000000000000000000000000000";
    safeTx.gasPrice = 10000000000;
    safeTx.targetTxGas = gasEstimate1.toNumber();
    safeTx.baseGas = 21000 + 21000; // base plus eth transfer

    const { signer, data } = await safeSignMessage(
      accounts[0],
      userSCW,
      safeTx,
      chainId
    );

    // console.log(safeTx);

    let signature = "0x";
    signature += data.slice(2);

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

    await expect(
      userSCW
        .connect(accounts[1])
        .execTransaction_S6W(transaction, refundInfo, signature, {
          gasPrice: safeTx.gasPrice,
        })
    ).to.emit(userSCW, "ExecutionSuccess");

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );

    const balanceAfter = await ethers.provider.getBalance(bob);
    console.log(balanceAfter.toString());
    if (balanceAfter.gt(balanceBefore)) {
      console.log("balance increased for bob");
    }
  });

  it("can send transactions and charge smart account for fees in erc20 tokens", async function () {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const tokenBalanceBefore = await token.balanceOf(bob);
    console.log(tokenBalanceBefore.toString());

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: await userSCW.getNonce(EOA_CONTROLLED_FLOW),
    });

    const gasEstimate1 = await ethers.provider.estimateGas({
      to: token.address,
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      from: userSCW.address,
    });

    const chainId = await userSCW.getChainId();

    safeTx.refundReceiver = "0x0000000000000000000000000000000000000000";
    safeTx.gasToken = token.address;
    safeTx.gasPrice = 1000000000000; // this would be token gas price
    safeTx.targetTxGas = gasEstimate1.toNumber();
    safeTx.baseGas = 21000 + gasEstimate1.toNumber() - 21000; // base plus erc20 token transfer

    const { signer, data } = await safeSignTypedData(
      accounts[0],
      userSCW,
      safeTx,
      chainId
    );

    // console.log(safeTx);

    let signature = "0x";
    signature += data.slice(2);

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

    await expect(
      userSCW
        .connect(accounts[1])
        .execTransaction_S6W(transaction, refundInfo, signature, {
          gasPrice: safeTx.gasPrice,
        })
    ).to.emit(userSCW, "ExecutionSuccess");

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );

    const tokenBalanceAfter = await token.balanceOf(bob);
    console.log(tokenBalanceAfter.toString());
  });

  // keep mixedAuth for setOwner() and write test cases to update it from owner and from sample social recovery module.
  it("can update owner by current owner or social recovery module", async function () {
    /// 1. update setOwner() by social recovery module
    // current owner - owner accounts[0]
    const currentOwner = await userSCW.owner();
    expect(currentOwner).to.equal(accounts[0].address);

    // social recovery module deploy - socialRecoveryModule
    const SocialRecoveryModule = await ethers.getContractFactory(
      "SocialRecoveryModule"
    );
    socialRecoveryModule = await SocialRecoveryModule.connect(
      accounts[0]
    ).deploy();
    console.log("SocialModule deployed at ", socialRecoveryModule.address);

    // setup social recovery module, set bob, charlie as friends and set threshold as 2
    // must be called via the users SCW
    const data = await socialRecoveryModule.interface.encodeFunctionData(
      "setup",
      [[bob, charlie], 2]
    );

    let tx = await userSCW
      .connect(accounts[0])
      .executeCall_s1m(socialRecoveryModule.address, 0, data);

    // Owner itself can not directly add modules
    tx = userSCW
      .connect(accounts[0])
      .enableModule(socialRecoveryModule.address);
    await expect(tx).to.be.reverted;
    // without enabling module one can't send transactions invoking account from module without enabling it!
    await expect(
      socialRecoveryModule
        .connect(charlie)
        .recoverAccess(userSCW.address, charlie)
    ).to.be.reverted;

    // Modules can only be enabled via safe transaction
    tx = executeContractCallWithSigners(
      userSCW,
      userSCW,
      "enableModule",
      [socialRecoveryModule.address],
      [accounts[0]]
    );
    await expect(tx).to.emit(userSCW, "ExecutionSuccess");

    // creating data and dataHash signed by owner
    const newOwner = accounts[5];
    // no need to create dataHash as it is already created in getRecoveryHash()
    // data = await userSCW.interface.encodeFunctionData("setOwner", [
    //   newOwner.address,
    // ]);
    // console.log("data ", data);
    // const dataHash = await socialRecoveryModule
    //   .connect(accounts[0])
    //   .getDataHash(data);
    // console.log("dataHash ", dataHash);

    // bob confirms transaction for setOwner()
    tx = await socialRecoveryModule
      .connect(accounts[1])
      .confirmTransaction(userSCW.address, newOwner.address);
    console.log(await userSCW.owner());
    // charlie confirms transaction for setOwner()
    tx = await socialRecoveryModule
      .connect(accounts[2])
      .confirmTransaction(userSCW.address, newOwner.address);
    // recoverAccess() will be invoked by module
    tx = await socialRecoveryModule
      .connect(accounts[1])
      .recoverAccess(userSCW.address, newOwner.address);

    console.log(
      "newOner should be",
      newOwner.address,
      "and is",
      await userSCW.owner()
    );
    // check if owner is updated
    expect(await userSCW.owner()).to.equal(newOwner.address);

    // will not be able to recoverAccess() again
    await expect(
      socialRecoveryModule
        .connect(accounts[1])
        .recoverAccess(userSCW.address, newOwner.address)
    ).to.be.reverted;

    /// 2. update setOwner() by current owner
    await expect(
      executeContractCallWithSigners(
        userSCW,
        userSCW,
        "setOwner",
        [accounts[0].address],
        [accounts[5]]
      )
    ).to.emit(userSCW, "ExecutionSuccess");

    console.log(
      "again newOner should be",
      accounts[0].address,
      "and is",
      await userSCW.owner()
    );
    expect(await userSCW.owner()).to.equal(accounts[0].address);
  });

  it("should not be able to updateImplementation from any module call", async function () {
    // deploy new implementation
    const UserSCWImpl2 = await ethers.getContractFactory(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount"
    );
    const userSCWImpl2 = await UserSCWImpl2.connect(accounts[0]).deploy(
      entryPoint.address
    );
    console.log("UserSCWImpl2 deployed at ", userSCWImpl2.address);

    // module deploy - WhitelistModule
    const WhitelistModule = await ethers.getContractFactory("WhitelistModule");
    const whitelistModule = await WhitelistModule.connect(accounts[0]).deploy(
      userSCW.address
    );
    console.log("WhitelistModule deployed at ", whitelistModule.address);

    const data = await userSCW.interface.encodeFunctionData(
      "updateImplementation",
      [userSCWImpl2.address] // new implementation
    );
    const tx = whitelistModule
      .connect(accounts[0])
      .authCall(userSCW.address, userSCW.address, 0, data);
    await expect(tx).to.be.reverted;
  });
});
