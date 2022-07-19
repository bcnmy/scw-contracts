import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import {
  SmartWallet,
  WalletFactory,
  EntryPoint,
  TestToken,
  MultiSend,
  StorageSetter,
  GasEstimator,
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
  executeTx,
  safeSignTypedData,
  buildSafeTransaction,
  executeContractCallWithSigners,
} from "../../src/utils/execution";
import { buildMultiSendSafeTx } from "../../src/utils/multisend";
import { BytesLike } from "ethers";
import { deployContract } from "../utils/setupHelper";
import { provider } from "ganache";

// NOTE :
// things to solve:
// i) getting signature twice for estimation
// ii) relayer should be able to check what is expected spend and what is being paid!

function tryDecodeError(bytes: BytesLike): string {
  try {
    return ethers.utils.toUtf8String(
      "0x" + ethers.utils.hexlify(bytes).substr(138)
    );
  } catch (e) {
    return "UNKNOWN_ERROR";
  }
}

const options = {
  dataZeroCost: 4,
  dataOneCost: 16,
  baseCost: 21000,
};

function txBaseCost(data: BytesLike): number {
  const bytes = ethers.utils.arrayify(data);
  return bytes
    .reduce(
      (p, c) =>
        c === 0 ? p.add(options.dataZeroCost) : p.add(options.dataOneCost),
      ethers.constants.Zero
    )
    .add(options.baseCost)
    .toNumber();
}

describe("Wallet tx gas estimations with and without refunds", function () {
  // TODO
  let baseImpl: SmartWallet;
  let walletFactory: WalletFactory;
  let entryPoint: EntryPoint;
  let token: TestToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let estimator: GasEstimator;
  let owner: string;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  let handler: DefaultCallbackHandler;
  const UNSTAKE_DELAY_SEC = 100;
  const PAYMASTER_STAKE = ethers.utils.parseEther("1");
  const create2FactoryAddress = "0xce0042B868300000d44A59004Da54A005ffdcf9f";
  let accounts: any;

  const decoderSource = `
            contract Decoder {
                function decode(address to, bytes memory data) public returns (bytes memory) {
                    (bool success, bytes memory data) = to.call(data);
                    require(!success, "Shit happens");
                    return data;
                }
            } `;

  // let estimate: (address: string, data: ethers.BytesLike) => { call: () => Promise<{success: boolean, result: string, gas: string}> }

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
    // const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

    const BaseImplementation = await ethers.getContractFactory("SmartWallet");
    baseImpl = await BaseImplementation.deploy();
    await baseImpl.deployed();
    console.log("base wallet impl deployed at: ", baseImpl.address);

    const WalletFactory = await ethers.getContractFactory("WalletFactory");
    walletFactory = await WalletFactory.deploy(baseImpl.address);
    await walletFactory.deployed();
    console.log("wallet factory deployed at: ", walletFactory.address);

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    entryPoint = await EntryPoint.deploy(
      create2FactoryAddress,
      PAYMASTER_STAKE,
      UNSTAKE_DELAY_SEC
    );
    await entryPoint.deployed();
    console.log("Entry point deployed at: ", entryPoint.address);

    const TestToken = await ethers.getContractFactory("TestToken");
    token = await TestToken.deploy();
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

    const Estimator = await ethers.getContractFactory("GasEstimator");
    estimator = await Estimator.deploy();
    console.log("Gas Estimator contract deployed at: ", estimator.address);

    console.log("mint tokens to owner address..");
    await token.mint(owner, ethers.utils.parseEther("1000000"));
  });

  // describe("Wallet initialization", function () {
  it("Should set the correct states on proxy", async function () {
    const expected = await walletFactory.getAddressForCounterfactualWallet(
      owner,
      0
    );
    console.log("deploying new wallet..expected address: ", expected);

    await expect(
      walletFactory.deployCounterFactualWallet(
        owner,
        entryPoint.address,
        handler.address,
        0
      )
    )
      .to.emit(walletFactory, "WalletCreated")
      .withArgs(expected, baseImpl.address, owner);

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartWallet.sol:SmartWallet",
      expected
    );

    const entryPointAddress = await userSCW.entryPoint();
    expect(entryPointAddress).to.equal(entryPoint.address);

    const walletOwner = await userSCW.owner();
    expect(walletOwner).to.equal(owner);

    const walletNonce1 = await userSCW.getNonce(0); // only 0 space is in the context now
    const walletNonce2 = await userSCW.getNonce(1);
    const chainId = await userSCW.getChainId();

    console.log("walletNonce1 ", walletNonce1);
    console.log("walletNonce2 ", walletNonce2);
    console.log("chainId ", chainId);

    await accounts[1].sendTransaction({
      from: bob,
      to: expected,
      value: ethers.utils.parseEther("5"),
    });
  });

  it("should send a single transacton and estimate gas for it", async function () {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: await userSCW.getNonce(0),
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
      gasToken: safeTx.gasToken,
      refundReceiver: safeTx.refundReceiver,
    };

    let signature = "0x";
    signature += data.slice(2);

    const SmartWallet = await ethers.getContractFactory("SmartWallet");

    const Estimator = await ethers.getContractFactory("GasEstimator");
    const gasEstimatorInterface = Estimator.interface;
    const encodedEstimate = gasEstimatorInterface.encodeFunctionData(
      "estimate",
      [
        userSCW.address,
        SmartWallet.interface.encodeFunctionData("execTransaction", [
          transaction,
          0, // batchId
          refundInfo,
          signature,
        ]),
      ]
    );

    const response = await ethers.provider.send("eth_call", [
      {
        to: estimator.address,
        data: encodedEstimate,
        from: bob,
        // gasPrice: ethers.BigNumber.from(100000000000).toHexString(),
        // gas: "200000",
      },
      "latest",
    ]);

    const decoded = gasEstimatorInterface.decodeFunctionResult(
      "estimate",
      response
    );

    if (!decoded.success) {
      throw Error(
        `Failed gas estimation with ${tryDecodeError(decoded.result)}`
      );
    }

    console.log(
      "estimated gas to be used ",
      ethers.BigNumber.from(decoded.gas)
        .add(txBaseCost(encodedEstimate))
        .toNumber()
    );

    // No gas refunds involved so not altering baseGas fields and no double sig

    // await expect(
    const txn = await userSCW.connect(accounts[0]).execTransaction(
      transaction,
      0, // batchId
      refundInfo,
      signature
    );

    const receipt = await txn.wait(1);
    console.log("Real txn gas used: ", receipt.gasUsed.toNumber());

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );
  });

  it("can send transactions and charge wallet for fees in erc20 tokens", async function () {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    console.log("tokens held by relayer before");
    const tokenBalanceBefore = await token.balanceOf(bob);
    console.log(tokenBalanceBefore.toString());

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: await userSCW.getNonce(0),
    });

    const gasEstimate1 = await ethers.provider.estimateGas({
      to: token.address,
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      from: userSCW.address,
    });

    const chainId = await userSCW.getChainId();

    safeTx.refundReceiver = "0x0000000000000000000000000000000000000000";
    safeTx.gasToken = token.address;
    safeTx.gasPrice = 1683625926886; // this would be token gas price
    safeTx.targetTxGas = gasEstimate1.toNumber();

    // 25945 is handlePayment for DAI
    safeTx.baseGas = 21000 + 4424 + 25945 + 10000; // this is offset;
    // can be added more for relayer premium

    console.log(safeTx);

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
      gasToken: safeTx.gasToken,
      refundReceiver: safeTx.refundReceiver,
    };

    const SmartWallet = await ethers.getContractFactory("SmartWallet");

    const Estimator = await ethers.getContractFactory("GasEstimator");
    const gasEstimatorInterface = Estimator.interface;
    const encodedEstimate = gasEstimatorInterface.encodeFunctionData(
      "estimate",
      [
        userSCW.address,
        SmartWallet.interface.encodeFunctionData("execTransaction", [
          transaction,
          0, // batchId
          refundInfo,
          signature,
        ]),
      ]
    );

    const response = await ethers.provider.send("eth_call", [
      {
        to: estimator.address,
        data: encodedEstimate,
        from: bob,
        // gasPrice: ethers.BigNumber.from(100000000000).toHexString(),
        // gas: "200000",
      },
      "latest",
    ]);

    const decoded = gasEstimatorInterface.decodeFunctionResult(
      "estimate",
      response
    );

    if (!decoded.success) {
      throw Error(
        `Failed gas estimation with ${tryDecodeError(decoded.result)}`
      );
    }

    const execTransactionGas = ethers.BigNumber.from(decoded.gas)
      .add(txBaseCost(encodedEstimate))
      .toNumber();
    console.log("estimated gas to be used ", execTransactionGas);

    const execTransactionData = SmartWallet.interface.encodeFunctionData(
      "execTransaction",
      [
        transaction,
        0, // batchId
        refundInfo,
        signature,
      ]
    );

    console.log("base cost would have been...");
    console.log(txBaseCost(execTransactionData));

    // await expect(
    const tx = await userSCW.connect(accounts[1]).execTransaction(
      transaction,
      0, // batchId
      refundInfo,
      signature
    );

    const receipt = await tx.wait(1);
    console.log("gasPrice: ", tx.gasPrice);
    console.log("real txn gas used: ", receipt.gasUsed.toNumber());

    console.log("Gas Prices");
    console.log(tx.gasPrice);
    console.log(receipt.effectiveGasPrice);

    const eventLogs = SmartWallet.interface.decodeEventLog(
      "ExecutionSuccess",
      receipt.logs[2].data
    );
    const paymentDeducted = eventLogs.payment; // no of DAI tokens
    console.log("tokens refund ", paymentDeducted);

    const gasFees = receipt.gasUsed.mul(receipt.effectiveGasPrice);
    console.log("gasFees", gasFees.toNumber());

    const ethusd = 1537; // fetch
    const daiusd = 1;

    /* expect(gasFees.toNumber()).to.approximately(
      paymentDeducted.div(ethers.BigNumber.from(ethusd)).toNumber(),
      ethers.BigNumber.from(11000).mul(receipt.effectiveGasPrice).toNumber()
    ); */

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );

    console.log("tokens held by relayer after");
    const tokenBalanceAfter = await token.balanceOf(bob);
    console.log(tokenBalanceAfter.toString());
  });

  it("can send transactions and charge wallet for fees in ether", async function () {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    console.log("ether held by relayer before");
    const tokenBalanceBefore = await ethers.provider.getBalance(bob);
    console.log(tokenBalanceBefore.toString());

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: await userSCW.getNonce(0),
    });

    const gasEstimate1 = await ethers.provider.estimateGas({
      to: token.address,
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      from: userSCW.address,
    });
    // this is fine as targetTxGas (can also get from safeServiceClient)

    const chainId = await userSCW.getChainId();

    safeTx.refundReceiver = "0x0000000000000000000000000000000000000000";
    safeTx.gasToken = "0x0000000000000000000000000000000000000000";
    safeTx.gasPrice = 1743296144515; // this would be very high gas price in case of eth refund
    safeTx.targetTxGas = gasEstimate1.toNumber();

    console.log(safeTx);

    // for base Gas we estimate handle payment here
    // 21000 + salt offset + handle payment estimate
    // instead of salt i could do this in fucntion itself using msg.data! write txBaseCost method in solidity

    // TODO
    // Estimate handle payment
    // using requiredTxGas or special method call from GasEstimator contract

    const SmartWallet = await ethers.getContractFactory("SmartWallet");

    const requiredTxGasData = SmartWallet.interface.encodeFunctionData(
      "handlePaymentAndRevert",
      [
        safeTx.targetTxGas,
        safeTx.targetTxGas,
        safeTx.gasPrice,
        safeTx.gasToken,
        safeTx.refundReceiver,
      ]
    );

    const [user1] = waffle.provider.getWallets();
    const decoder = await deployContract(user1, decoderSource);

    const result = await decoder.callStatic.decode(
      userSCW.address,
      requiredTxGasData
    );
    console.log(result);
    const internalEstimate = ethers.BigNumber.from(
      "0x" + result.slice(result.length - 32)
    ).toNumber();
    console.log("handle eth payment gas estimation: ", internalEstimate);

    // 7299 is handlePayment!
    safeTx.baseGas = 21000 + 4172 + 7299 + 10000; // this is offset;
    // + 10000; // another 10k % fee on top?
    // for a matter of fact i know it is 7325 for ether payment

    console.log(safeTx);

    const { signer, data } = await safeSignTypedData(
      accounts[0],
      userSCW,
      safeTx,
      chainId
    );

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
      gasToken: safeTx.gasToken,
      refundReceiver: safeTx.refundReceiver,
    };

    const tx = await userSCW.connect(accounts[1]).execTransaction(
      transaction,
      0, // batchId
      refundInfo,
      signature
    );

    const execTransactionData = SmartWallet.interface.encodeFunctionData(
      "execTransaction",
      [
        transaction,
        0, // batchId
        refundInfo,
        signature,
      ]
    );

    console.log("base cost would have been...");
    console.log(txBaseCost(execTransactionData));

    const receipt = await tx.wait(1);
    console.log("gasPrice: ", tx.gasPrice);
    console.log("real txn gas used: ", receipt.gasUsed.toNumber());

    console.log("Gas Prices");
    console.log(tx.gasPrice);
    console.log(receipt.effectiveGasPrice);

    const eventLogs = SmartWallet.interface.decodeEventLog(
      "ExecutionSuccess",
      receipt.logs[1].data
    );
    const paymentDeducted = eventLogs.payment.toNumber();

    const gasFees = receipt.gasUsed.mul(receipt.effectiveGasPrice);
    console.log("gasFees", gasFees.toNumber());

    expect(gasFees.toNumber()).to.approximately(
      paymentDeducted,
      ethers.BigNumber.from(2800).mul(receipt.effectiveGasPrice).toNumber()
    );

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );

    console.log("native tokens held by relayer after");
    const tokenBalanceAfter = await ethers.provider.getBalance(bob);
    console.log(tokenBalanceAfter.toString());

    const diff = tokenBalanceAfter.sub(tokenBalanceBefore).toNumber();
    console.log("difference is after - before", diff); // ideally should be nearly 0 or positive

    // 0.000002985503910649
    // }
  });
});
