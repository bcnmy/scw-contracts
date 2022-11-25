// Just estimating using eth_call. no fake sig yet cause doing on mumbai and not ganache

import { expect } from "chai";
import { ethers } from "hardhat";
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
import { BytesLike, Contract } from "ethers";
import { encodeTransfer, encodeTransferFrom } from "../smart-wallet/testUtils";
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

describe("Wallet tx deployment + batch gas estimation", function () {
  let baseImpl: Contract;
  let walletFactory: Contract;
  let entryPoint: Contract;
  // let token: TestToken;
  let realUSDC: Contract;
  let multiSend: Contract;
  let multiSendCall: Contract;
  let storage: StorageSetter;
  let estimator: Contract;
  let owner: string;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  let handler: Contract;
  const UNSTAKE_DELAY_SEC = 100;
  const PAYMASTER_STAKE = ethers.utils.parseEther("1");
  // const create2FactoryAddress = "0xce0042B868300000d44A59004Da54A005ffdcf9f";
  let accounts: any;

  /* const decoderSource = `
            contract Decoder {
                function decode(address to, bytes memory data) public returns (bytes memory) {
                    (bool success, bytes memory data) = to.call(data);
                    require(!success, "Shit happens");
                    return data;
                }
            } `; */

  // let estimate: (address: string, data: ethers.BytesLike) => { call: () => Promise<{success: boolean, result: string, gas: string}> }

  /* const domainType = [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
    ]; */

  before(async () => {
    accounts = await ethers.getSigners();
    // const addresses = await ethers.provider.listAccounts();
    // const ethersSigner = ethers.provider.getSigner();

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();
    console.log("owner address ", owner);

    const baseWalletAddress = "0x1572bE4ca6EE072b3A3F82dCA003ED980ff98732";
    const multiSendAddress = "0x2f65bed438a30827d408b7c6818ec5a22c022dd1";
    const multiSendCallAddress = "0xa1677d8c8edb188e49ecd832236af281d6b0b20e";
    const walletFactoryAddress = "0xf59cda6fd211303bfb79f87269abd37f565499d8";
    const entryPointAddress = "0x119Df1582E0dd7334595b8280180f336c959F3bb";
    const fallbackHandlerAddress = "0x0bc0c08122947be919a02f9861d83060d34ea478";
    const gasEstimatorAddress = "0x65db1c3c53b7e4eea71eba504d8f05369e63ed34";
    const decoderAddress = "0x69214e26ab458fe20b7c3337530b994cd49c8686";
    const usdcMumbai = "0xdA5289fCAAF71d52a80A254da614a192b693e977";
    const usdtMumbai = "0xeaBc4b91d9375796AA4F69cC764A4aB509080A58";

    /* const BaseImplementation = await ethers.getContractFactory("SmartWallet");
    baseImpl = await BaseImplementation.deploy();
    await baseImpl.deployed();
    console.log("base wallet impl deployed at: ", baseImpl.address); */

    baseImpl = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartWallet.sol:SmartWallet",
      baseWalletAddress
    );

    /* const WalletFactory = await ethers.getContractFactory("WalletFactory");
    walletFactory = await WalletFactory.deploy(baseImpl.address);
    await walletFactory.deployed();
    console.log("wallet factory deployed at: ", walletFactory.address); */

    walletFactory = await ethers.getContractAt(
      "contracts/smart-contract-wallet/WalletFactory.sol:WalletFactory",
      walletFactoryAddress
    );

    /* const EntryPoint = await ethers.getContractFactory("EntryPoint");
    entryPoint = await EntryPoint.deploy(PAYMASTER_STAKE, UNSTAKE_DELAY_SEC);
    await entryPoint.deployed();
    console.log("Entry point deployed at: ", entryPoint.address); */

    entryPoint = await ethers.getContractAt(
      "contracts/smart-contract-wallet/aa-4337/core/EntryPoint.sol:EntryPoint",
      entryPointAddress
    );

    /* const TestToken = await ethers.getContractFactory("TestToken");
    token = await TestToken.deploy();
    await token.deployed();
    console.log("Test token deployed at: ", token.address); */

    realUSDC = await ethers.getContractAt(
      "contracts/smart-contract-wallet/test/IERC20.sol:IERC20",
      usdcMumbai
    );

    /* const DefaultHandler = await ethers.getContractFactory(
        "DefaultCallbackHandler"
      );
      handler = await DefaultHandler.deploy();
      await handler.deployed();
      console.log("Default callback handler deployed at: ", handler.address); */

    handler = await ethers.getContractAt(
      "contracts/smart-contract-wallet/handler/DefaultCallbackHandler.sol:DefaultCallbackHandler",
      fallbackHandlerAddress
    );

    const Storage = await ethers.getContractFactory("StorageSetter");
    storage = await Storage.deploy();
    console.log("storage setter contract deployed at: ", storage.address);

    /* const MultiSend = await ethers.getContractFactory("MultiSend");
    multiSend = await MultiSend.deploy();
    console.log("Multisend helper contract deployed at: ", multiSend.address); */

    multiSend = await ethers.getContractAt(
      "contracts/smart-contract-wallet/libs/MultiSend.sol:MultiSend",
      multiSendAddress
    );

    /* const MultiSendCallOnly = await ethers.getContractFactory("MultiSendCallOnly");
    multiSendCall = await MultiSendCallOnly.deploy();
    console.log("MultiSendCallOnly helper contract deployed at: ", multiSendCall.address); */

    multiSendCall = await ethers.getContractAt(
      "contracts/smart-contract-wallet/libs/MultiSendCallOnly.sol:MultiSendCallOnly",
      multiSendCallAddress
    );

    /* const Estimator = await ethers.getContractFactory("GasEstimator");
    estimator = await Estimator.deploy();
    console.log("Gas Estimator contract deployed at: ", estimator.address); */

    estimator = await ethers.getContractAt(
      "contracts/smart-contract-wallet/utils/GasEstimator.sol:GasEstimator",
      gasEstimatorAddress
    );

    // console.log("mint tokens to owner address..");
    // await token.mint(owner, ethers.utils.parseEther("1000000"));
    const bal = await realUSDC.balanceOf(owner);
    console.log("owner usdc balance ", bal.toNumber());
  });

  // describe("Wallet initialization", function () {
  it("Should set the correct states on proxy", async function () {
    const expected = await walletFactory.getAddressForCounterfactualWallet(
      owner,
      10
    );
    console.log("deploying new wallet..expected address: ", expected);

    await expect(
      walletFactory
        .connect(accounts[3])
        .deployCounterFactualWallet(
          owner,
          entryPoint.address,
          handler.address,
          10
        )
    )
      .to.emit(walletFactory, "WalletCreated")
      .withArgs(expected, baseImpl.address, owner, "1.0.1", 10);

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

  it("should send a single transacton for deployed wallet and estimate gas", async function () {
    await realUSDC.connect(accounts[0]).transfer(userSCW.address, "10000000");

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: realUSDC.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, "1000000"),
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
      tokenGasPriceFactor: safeTx.tokenGasPriceFactor,
      gasToken: safeTx.gasToken,
      refundReceiver: safeTx.refundReceiver,
    };

    let signature = "0x";
    signature += data.slice(2);

    // Here we are getting signature and then doing gas estimation prior to sending Tx...

    // requiredTxGas should be estimated for any flow. (deployed case here...)

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

    // await expect(
    const txn = await userSCW.connect(accounts[0]).execTransaction(
      transaction,
      0, // batchId
      refundInfo,
      signature
    );

    const receipt = await txn.wait(1);
    console.log("Real txn gas used: ", receipt.gasUsed.toNumber());

    expect(await realUSDC.balanceOf(charlie)).to.equal("1000000");
  });
});
