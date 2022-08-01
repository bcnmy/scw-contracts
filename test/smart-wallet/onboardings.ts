import { expect } from "chai";
import { artifacts, web3, ethers, waffle } from "hardhat";
import {
  SmartWallet,
  WalletFactory,
  EntryPoint,
  TestToken,
  MultiSendCallOnly,
  StorageSetter,
  GasEstimator,
  DefaultCallbackHandler,
  WhitelistModule,
  StakedTestToken,
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

import {
  encodeMultiSend,
  buildMultiSendSafeTx,
} from "../../src/utils/multisend";
import { BytesLike } from "ethers";
import { deployContract } from "../utils/setupHelper";
import { provider } from "ganache";
import { sign } from "crypto";

const SCWNoAuth = require("/Users/chirag/work/biconomy/scw-playground/scw-contracts/artifacts/contracts/smart-contract-wallet/SmartWalletNoAuth.sol/SmartWalletNoAuth.json");
const SCW = require("/Users/chirag/work/biconomy/scw-playground/scw-contracts/artifacts/contracts/smart-contract-wallet/SmartWallet.sol/SmartWallet.json");

const GasEstimatorArtifact = artifacts.require("GasEstimator");

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

describe("Wallet deployment cost estimation in various onbaording flows", function () {
  let baseImpl: SmartWallet;
  let walletFactory: WalletFactory;
  let entryPoint: EntryPoint;
  let token: TestToken;
  let stToken: StakedTestToken;
  let multiSend: MultiSendCallOnly;
  let storage: StorageSetter;
  let estimator: GasEstimator;
  let whitelistModule: WhitelistModule;
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

    const StakedTestToken = await ethers.getContractFactory("StakedTestToken");
    stToken = await StakedTestToken.deploy(token.address);
    await token.deployed();
    console.log("Test token deployed at: ", stToken.address);

    const DefaultHandler = await ethers.getContractFactory(
      "DefaultCallbackHandler"
    );
    handler = await DefaultHandler.deploy();
    await handler.deployed();
    console.log("Default callback handler deployed at: ", handler.address);

    const Storage = await ethers.getContractFactory("StorageSetter");
    storage = await Storage.deploy();
    console.log("storage setter contract deployed at: ", storage.address);

    const MultiSend = await ethers.getContractFactory("MultiSendCallOnly");
    multiSend = await MultiSend.deploy();
    console.log("Multisend helper contract deployed at: ", multiSend.address);

    const Estimator = await ethers.getContractFactory("GasEstimator");
    estimator = await Estimator.deploy();
    console.log("Gas Estimator contract deployed at: ", estimator.address);

    const WhitelistModule = await ethers.getContractFactory("WhitelistModule");
    whitelistModule = await WhitelistModule.deploy(charlie);
    console.log(
      "Whitelist module contract deployed at: ",
      whitelistModule.address
    );

    console.log("mint tokens to owner address..");
    await token.mint(owner, ethers.utils.parseEther("1000000"));
  });

  // describe("Wallet initialization", function () {
  it("Should estimate wallet deployment", async function () {
    const expected = await walletFactory.getAddressForCounterfactualWallet(
      owner,
      0
    );
    console.log("deploying new wallet..expected address: ", expected);

    const Estimator = await ethers.getContractFactory("GasEstimator");
    const WalletFactory = await ethers.getContractFactory("WalletFactory");
    const gasEstimatorInterface = Estimator.interface;
    const encodedEstimate = gasEstimatorInterface.encodeFunctionData(
      "estimate",
      [
        walletFactory.address,
        WalletFactory.interface.encodeFunctionData(
          "deployCounterFactualWallet",
          [owner, entryPoint.address, handler.address, 0]
        ),
      ]
    );

    const gasEstimatorNew = await GasEstimatorArtifact.new();
    const estimate = gasEstimatorNew.contract.methods.estimate;

    const estimated = ethers.BigNumber.from(
      (
        await estimate(
          walletFactory.address,
          WalletFactory.interface.encodeFunctionData(
            "deployCounterFactualWallet",
            [owner, entryPoint.address, handler.address, 0]
          )
        ).call()
      ).gas
    ).toNumber();

    const txnData = WalletFactory.interface.encodeFunctionData(
      "deployCounterFactualWallet",
      [owner, entryPoint.address, handler.address, 0]
    );

    console.log("estimated using call() : ", estimated + txBaseCost(txnData));

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

    const deployTransactionGas = ethers.BigNumber.from(decoded.gas)
      .add(txBaseCost(txnData))
      .toNumber();
    console.log("estimated gas to be used ", deployTransactionGas);

    const tx = await walletFactory.deployCounterFactualWallet(
      owner,
      entryPoint.address,
      handler.address,
      0
    );

    const receipt = await tx.wait(1);

    console.log("Real transaction gas used: ", receipt.gasUsed.toNumber());

    expect(deployTransactionGas).to.approximately(
      receipt.gasUsed.toNumber(),
      5000
    );

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

  // TODO
  // Review
  it("Should estimate wallet deployment and send first transacton", async function () {
    const expected = await walletFactory.getAddressForCounterfactualWallet(
      owner,
      1
    );
    console.log("deploying new wallet..expected address: ", expected);

    await token
      .connect(accounts[0])
      .transfer(expected, ethers.utils.parseEther("100"));

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: 0, // nonce picked 0 for first transaction as we can't read from state yet (?)
    });

    const Estimator = await ethers.getContractFactory("GasEstimator");
    const MultiSend = await ethers.getContractFactory("MultiSendCallOnly");
    const gasEstimatorInterface = Estimator.interface;

    const chainId = await userSCW.getChainId();
    userSCW = userSCW.attach(expected);
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

    const txs: MetaTransaction[] = [
      buildContractCall(
        walletFactory,
        "deployCounterFactualWallet",
        [owner, entryPoint.address, handler.address, 1],
        0
      ),
      buildContractCall(
        userSCW,
        "execTransaction",
        [transaction, 1, refundInfo, signature],
        0
      ),
    ];

    const txnData = MultiSend.interface.encodeFunctionData("multiSend", [
      encodeMultiSend(txs),
    ]);

    const encodedEstimate = gasEstimatorInterface.encodeFunctionData(
      "estimate",
      [multiSend.address, txnData]
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
      /* {
        [expected]: {
          code: SCWNoAuth.deployedBytecode,
        },
      }, */
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
      ethers.BigNumber.from(decoded.gas).add(txBaseCost(txnData)).toNumber()
    );

    // await expect(
    const txn = await multiSend
      .connect(accounts[0])
      .multiSend(encodeMultiSend(txs));

    const receipt = await txn.wait(1);
    console.log("Real txn gas used: ", receipt.gasUsed.toNumber());

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );
  });

  // send regular baseGas for txn + send wallet deployment gas!
  // we could probably do simulate for each tx and add for one
  it("Should estimate wallet deployment and send first transacton and charge fees in ether", async function () {
    // we know estimated gas for wallet deployment
    const walletDeployApprox = 264722;

    const expected = await walletFactory.getAddressForCounterfactualWallet(
      owner,
      1
    );
    console.log("deploying new wallet..expected address: ", expected);

    await accounts[1].sendTransaction({
      from: bob,
      to: expected,
      value: ethers.utils.parseEther("5"),
    });

    console.log("ether held by relayer before");
    const tokenBalanceBefore = await ethers.provider.getBalance(bob);
    console.log(tokenBalanceBefore.toString());

    await token
      .connect(accounts[0])
      .transfer(expected, ethers.utils.parseEther("100"));

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: 0, // nonce picked 0 for first transaction as we can't read from state yet (?)
    });

    /* const gasEstimate1 = await ethers.provider.estimateGas({
      to: token.address,
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      from: userSCW.address,
    }); */

    safeTx.refundReceiver = "0x0000000000000000000000000000000000000000";
    safeTx.gasToken = "0x0000000000000000000000000000000000000000";
    safeTx.gasPrice = 1743296144515; // this would be very high gas price in case of eth refund
    safeTx.targetTxGas = 70000; // non-zero // please note whenever fee refund is involved targetTxGas should not be sent 0!
    // 7299 is handle payment
    safeTx.baseGas = walletDeployApprox + 7299 + 10000; // this is offset;
    // notice we did not add 21000 here

    const Estimator = await ethers.getContractFactory("GasEstimator");
    const MultiSend = await ethers.getContractFactory("MultiSendCallOnly");
    const gasEstimatorInterface = Estimator.interface;

    const chainId = await userSCW.getChainId();
    userSCW = userSCW.attach(expected);

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

    // One more thing we can do for base gas is that we could estimate individual txns seperately (mostly wallet deployment) and add handlePayment gas in one of safe txns!
    const txs: MetaTransaction[] = [
      buildContractCall(
        walletFactory,
        "deployCounterFactualWallet",
        [owner, entryPoint.address, handler.address, 1],
        0
      ),
      buildContractCall(
        userSCW,
        "execTransaction",
        [transaction, 1, refundInfo, signature],
        0
      ),
    ];

    const txnData = MultiSend.interface.encodeFunctionData("multiSend", [
      encodeMultiSend(txs),
    ]);

    const encodedEstimate = gasEstimatorInterface.encodeFunctionData(
      "estimate",
      [multiSend.address, txnData]
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
      /* {
        [userSCW.address]: {
          code: SCWNoAuth.deployedBytecode,
        },
      }, */
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
      ethers.BigNumber.from(decoded.gas).add(txBaseCost(txnData)).toNumber()
    );

    // await expect(
    const txn = await multiSend
      .connect(accounts[1])
      .multiSend(encodeMultiSend(txs));

    /* const execTransactionData = MultiSend.interface.encodeFunctionData(
      "multisend",
      [encodeMultiSend(txs)]
    );

    console.log("base cost would have been...");
    console.log(txBaseCost(execTransactionData)); */

    const receipt = await txn.wait(1);
    console.log("gasPrice: ", txn.gasPrice);
    console.log("real txn gas used: ", receipt.gasUsed.toNumber());

    console.log("Gas Prices");
    console.log(txn.gasPrice);
    console.log(receipt.effectiveGasPrice);

    const eventLogs = SmartWallet.interface.decodeEventLog(
      "ExecutionSuccess",
      receipt.logs[3].data
    );
    const paymentDeducted = eventLogs.payment.toString();
    console.log(paymentDeducted);

    const gasFees = receipt.gasUsed.mul(receipt.effectiveGasPrice);
    console.log("gasFees", gasFees.toString());

    expect(gasFees.toNumber()).to.approximately(
      Number(paymentDeducted),
      ethers.BigNumber.from(5000).mul(receipt.effectiveGasPrice).toNumber()
    );

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );

    console.log("native tokens held by relayer after");
    const tokenBalanceAfter = await ethers.provider.getBalance(bob);
    console.log(tokenBalanceAfter.toString());

    const diff = tokenBalanceAfter.sub(tokenBalanceBefore).toNumber();
    console.log("difference is after - before", diff); // ideally should be nearly 0 or positive
  });

  it("Should estimate wallet deployment and enable module", async function () {
    const expected = await walletFactory.getAddressForCounterfactualWallet(
      owner,
      1
    );
    console.log("deploying new wallet..expected address: ", expected);

    const SmartWallet = await ethers.getContractFactory("SmartWallet");

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: expected,
      // value: ethers.utils.parseEther("1"),
      data: SmartWallet.interface.encodeFunctionData("enableModule", [
        whitelistModule.address,
      ]),
      nonce: 0, // nonce picked 0 for first transaction as we can't read from state yet (?)
    });

    const Estimator = await ethers.getContractFactory("GasEstimator");
    const MultiSend = await ethers.getContractFactory("MultiSendCallOnly");
    const gasEstimatorInterface = Estimator.interface;

    const chainId = await userSCW.getChainId();
    userSCW = userSCW.attach(expected);
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

    const txs: MetaTransaction[] = [
      buildContractCall(
        walletFactory,
        "deployCounterFactualWallet",
        [owner, entryPoint.address, handler.address, 1],
        0
      ),
      buildContractCall(
        userSCW,
        "execTransaction",
        [transaction, 1, refundInfo, signature],
        0
      ),
    ];

    const txnData = MultiSend.interface.encodeFunctionData("multiSend", [
      encodeMultiSend(txs),
    ]);

    const encodedEstimate = gasEstimatorInterface.encodeFunctionData(
      "estimate",
      [multiSend.address, txnData]
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
      /* {
        [userSCW.address]: {
          code: SCWNoAuth.deployedBytecode,
        },
      }, */
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
      ethers.BigNumber.from(decoded.gas).add(txBaseCost(txnData)).toNumber()
    );

    // await expect(
    const txn = await multiSend
      .connect(accounts[0])
      .multiSend(encodeMultiSend(txs));

    const receipt = await txn.wait(1);
    console.log("Real txn gas used: ", receipt.gasUsed.toNumber());
  });

  // MultiSendCallOnly -> WalletFactory
  //                   -> Wallet -> MultiSend (delegateCall) -> enable module
  //                                                         -> lego approve and stake
  it("Should estimate wallet deployment, enable module and send basic lego", async function () {
    const expected = await walletFactory.getAddressForCounterfactualWallet(
      owner,
      1
    );
    console.log("deploying new wallet..expected address: ", expected);

    const chainId = await userSCW.getChainId();
    userSCW = userSCW.attach(expected);

    // sending tokens to counter factual wallet address so it can pay or transfer funds

    await token
      .connect(accounts[0])
      .transfer(expected, ethers.utils.parseEther("100"));

    const batch: MetaTransaction[] = [
      buildContractCall(userSCW, "enableModule", [whitelistModule.address], 0),
      buildContractCall(
        token,
        "approve",
        [stToken.address, ethers.utils.parseEther("10")],
        0
      ),
      buildContractCall(
        stToken,
        "stake",
        [charlie, ethers.utils.parseEther("10")],
        0
      ),
    ];

    const safeTx: SafeTransaction = buildMultiSendSafeTx(
      multiSend,
      batch,
      0 // await userSCW.getNonce(0) //should send 0 because can not query until deployment
    );

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
      gasToken: safeTx.gasToken,
      refundReceiver: safeTx.refundReceiver,
    };

    let signature = "0x";
    signature += data.slice(2);

    const Estimator = await ethers.getContractFactory("GasEstimator");
    const MultiSend = await ethers.getContractFactory("MultiSendCallOnly");
    const gasEstimatorInterface = Estimator.interface;

    // TODO
    // In the sdk relayer sendTransaction (wallet.executeTransaction) check if wallet exits and make helper to prepend the deployment
    // i.e. bundleWithDeploy

    const txs: MetaTransaction[] = [
      buildContractCall(
        walletFactory,
        "deployCounterFactualWallet",
        [owner, entryPoint.address, handler.address, 1],
        0
      ),
      buildContractCall(
        userSCW,
        "execTransaction",
        [transaction, 1, refundInfo, signature],
        0
      ),
    ];

    // For deployment with some action we always send to MultiSendCallOnly

    const txnData = MultiSend.interface.encodeFunctionData("multiSend", [
      encodeMultiSend(txs),
    ]);

    const encodedEstimate = gasEstimatorInterface.encodeFunctionData(
      "estimate",
      [multiSend.address, txnData]
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
      /* {
        [userSCW.address]: {
          code: SCWNoAuth.deployedBytecode,
        },
      }, */
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
      ethers.BigNumber.from(decoded.gas).add(txBaseCost(txnData)).toNumber()
    );

    // await expect(
    const txn = await multiSend
      .connect(accounts[0])
      .multiSend(encodeMultiSend(txs));

    const receipt = await txn.wait(1);
    console.log("Real txn gas used: ", receipt.gasUsed.toNumber());
    // TODO // Review
    // Major difference here

    expect(await stToken.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );
  });
});
