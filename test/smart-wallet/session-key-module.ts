import { expect } from "chai";
import hre, { ethers, waffle } from "hardhat";
import { ethers as originalEthers, BytesLike } from "ethers";
import {
  SessionKeyModule,
  TestToken,
  SmartWallet,
  WalletFactory,
  EntryPoint,
  TestToken,
  MultiSend,
  StorageSetter,
  GasEstimator,
  DefaultCallbackHandler,
} from "../../typechain";
import { assert } from "console";

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
  sessionSignTypedData,
  executeContractCallWithSigners,
} from "../../src/utils/execution";
import { buildMultiSendSafeTx } from "../../src/utils/multisend";
import { deployContract } from "../utils/setupHelper";
import { provider } from "ganache";

describe("Session Key Module", function () {
  let sessionKeyModule: SessionKeyModule;
  let token: TestToken;
  let accounts: any;
  let owner: string;

  // TODO
  let baseImpl: SmartWallet;
  let walletFactory: WalletFactory;
  let entryPoint: EntryPoint;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let estimator: GasEstimator;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  let handler: DefaultCallbackHandler;
  const UNSTAKE_DELAY_SEC = 100;
  const VERSION = "1.0.1";
  const PAYMASTER_STAKE = ethers.utils.parseEther("1");

  let sessionKey: string;
  // TBD
  // no need
  // const sessionKeyPrivateKey = "42a2acfd6eda24ef49d232e127d6998f8917b0aaea0a7d6d88026932adc688eb";

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    sessionKey = bob; // accounts[1]
    charlie = await accounts[2].getAddress();

    const TestToken = await ethers.getContractFactory("TestToken");
    token = await TestToken.deploy();
    await token.deployed();
    console.log("Test token deployed at: ", token.address);

    const BaseImplementation = await ethers.getContractFactory("SmartWallet");
    baseImpl = await BaseImplementation.deploy();
    await baseImpl.deployed();
    console.log("base wallet impl deployed at: ", baseImpl.address);

    const WalletFactory = await ethers.getContractFactory("WalletFactory");
    walletFactory = await WalletFactory.deploy(baseImpl.address);
    await walletFactory.deployed();
    console.log("wallet factory deployed at: ", walletFactory.address);

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    entryPoint = await EntryPoint.deploy(PAYMASTER_STAKE, UNSTAKE_DELAY_SEC);
    await entryPoint.deployed();
    console.log("Entry point deployed at: ", entryPoint.address);

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

    // await token.mint(owner, ethers.utils.parseEther("1000000"));
    const sessionKeyModuleFactory = await hre.ethers.getContractFactory(
      "SessionKeyModule"
    );
    sessionKeyModule = await sessionKeyModuleFactory.deploy();

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
      .withArgs(expected, baseImpl.address, owner, VERSION, 0);

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartWallet.sol:SmartWallet",
      expected
    );
  });

  it("Set and verify session with permission", async function () {
    // TODO: Review
    const startTimestamp = 1665239610;
    const endTimestamp = 1665326010;
    const sessionParam = {
      startTimestamp: startTimestamp,
      endTimestamp: endTimestamp,
      enable: true,
    };

    const ABI = ["function transfer(address to, uint256 amount)"];
    const iface = new originalEthers.utils.Interface(ABI);
    const encodedData = iface.encodeFunctionData("transfer", [
      "0x1234567890123456789012345678901234567890",
      "10000000000",
    ]);

    const transferFunctionSignature = encodedData.slice(0, 10);

    console.log(transferFunctionSignature);
    const permissionParam = {
      whitelistDestination: token.address,
      whitelistMethods: [transferFunctionSignature],
      tokenAmount: 100000000,
    };

    // Instead of this do a transaction from SCW
    const session = await sessionKeyModule.createSession(
      sessionKey,
      [permissionParam],
      sessionParam
    );
    await session.wait();

    const sessionInfo = await sessionKeyModule.getSessionInfo(sessionKey);

    assert(
      sessionInfo.startTimestamp.toNumber() === startTimestamp,
      "Start timestamp doesn't match"
    );
    assert(
      sessionInfo.endTimestamp.toNumber() === endTimestamp,
      "End timestamp doesn't match"
    );
    assert(sessionInfo.enable, "Session is not enabled");
    const whitelistedAddress = await sessionKeyModule.getWhitelistDestinations(
      sessionKey
    );
    const whitelistedMethods = await sessionKeyModule.getWhitelistMethods(
      sessionKey,
      token.address
    );

    assert(
      whitelistedAddress.length > 0,
      "Destination address are not whitelisted properly"
    );
    assert(
      whitelistedAddress[0] === token.address,
      "Whitelisted address does not match"
    );

    assert(
      whitelistedMethods.length > 0,
      "Destination contract methods are not whitelisted properly"
    );
    assert(
      whitelistedMethods[0] === transferFunctionSignature,
      "Whitelisted Destination contract methods does not match"
    );

    // console.log(sessionInfo);
    // console.log(whitelistedAddress);
  });

  it("Set session from SCW and enable module", async function () {
    const startTimestamp = 1665350119;
    const endTimestamp = 1665436509;
    const sessionParam = {
      startTimestamp: startTimestamp,
      endTimestamp: endTimestamp,
      enable: true,
    };

    const ABI = ["function transfer(address to, uint256 amount)"];
    const iface = new originalEthers.utils.Interface(ABI);
    const encodedData = iface.encodeFunctionData("transfer", [
      "0x1234567890123456789012345678901234567890",
      ethers.utils.parseEther("1000").toString(),
    ]);

    const transferFunctionSignature = encodedData.slice(0, 10);

    console.log(transferFunctionSignature);
    const permissionParam = {
      whitelistDestination: token.address,
      whitelistMethods: [transferFunctionSignature],
      tokenAmount: ethers.utils.parseEther("1000").toString(),
    };

    await expect(
      executeContractCallWithSigners(
        userSCW,
        sessionKeyModule,
        "createSession",
        [sessionKey, [permissionParam], sessionParam],
        [accounts[0]]
      )
    ).to.emit(userSCW, "ExecutionSuccess");

    // Modules can only be enabled via safe transaction
    // Enabling module
    // Modules can only be enabled via safe transaction
    await expect(
      executeContractCallWithSigners(
        userSCW,
        userSCW,
        "enableModule",
        [sessionKeyModule.address],
        [accounts[0]]
      )
    ).to.emit(userSCW, "ExecutionSuccess");

    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const sessionExecuteTx = {
      // sessionKey: sessionKey,
      to: token.address,
      amount: 0,
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: (
        await sessionKeyModule.getSessionInfo(sessionKey)
      ).nonce.toNumber(),
    };

    const sessionInfo = await sessionKeyModule.getSessionInfo(sessionKey);
    console.log("sessionInfo");
    console.log(sessionInfo);

    const whitelistInfo = await sessionKeyModule.getWhitelistMethods(
      sessionKey,
      token.address
    );
    console.log("whitelist info");
    console.log(whitelistInfo);

    console.log("sessionExecuteTx");
    console.log(sessionExecuteTx);

    const chainId = await userSCW.getChainId();

    const { signer, data } = await sessionSignTypedData(
      accounts[1],
      sessionKeyModule,
      sessionExecuteTx,
      chainId
    );

    let signature = "0x";
    signature += data.slice(2);
    console.log("signature");
    console.log(signature);

    const tx = await sessionKeyModule
      .connect(accounts[2])
      .executeTransaction(
        sessionKey,
        token.address,
        0,
        encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
        signature
      );

    const receipt = await tx.wait(1);
    console.log(receipt);

    // Can get session info using session key
    // const sessionInfo = await sessionKeyModule.getSessionInfo(sessionKey);
  });
});
