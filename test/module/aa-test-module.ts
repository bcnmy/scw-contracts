import { expect } from "chai";
import { ethers } from "hardhat";
import {
  SmartWallet,
  WalletFactory,
  EntryPoint,
  EntryPoint__factory,
  VerifyingSingletonPaymaster,
  VerifyingSingletonPaymaster__factory,
  MockToken,
  MultiSend,
  StorageSetter,
  WhitelistModule,
  DefaultCallbackHandler,
} from "../../typechain";
import { AddressZero } from "../smart-wallet/testutils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { encodeTransfer, encodeTransferFrom } from "../smart-wallet/testUtils";
import { fillAndSign, fillUserOp } from "../utils/userOp";
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
} from "../../src/utils/execution";
import { buildMultiSendSafeTx } from "../../src/utils/multisend";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";
import { BigNumber, BigNumberish, Contract, Signer } from "ethers";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

describe("Base Wallet Functionality", function () {
  let entryPoint: EntryPoint;
  let entryPointStatic: EntryPoint;
  let depositorSigner: Signer;
  let walletOwner: Signer;
  let proxyPaymaster: Contract;
  // let whitelistModule: WhitelistModule;
  let walletAddress: string, paymasterAddress: string;
  let ethersSigner;

  let offchainSigner: Signer, deployer: Signer;

  let verifyingSingletonPaymaster: VerifyingSingletonPaymaster;
  let verifyPaymasterFactory: VerifyingPaymasterFactory;
  let baseImpl: SmartWallet;
  let walletFactory: WalletFactory;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let owner: string;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  let smartWalletImp: SmartWallet;
  let maliciousWallet: MaliciousAccount;
  let callBackHandler: DefaultCallbackHandler;
  let handler: DefaultCallbackHandler;
  const VERSION = "1.0.4";
  const create2FactoryAddress = "0xce0042B868300000d44A59004Da54A005ffdcf9f";
  let accounts: any;

  /* const domainType = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "verifyingContract", type: "address" },
    { name: "salt", type: "bytes32" },
  ]; */

  beforeEach(async () => {
    accounts = await ethers.getSigners();

    ethersSigner = await ethers.getSigners();
    entryPoint = await deployEntryPoint();
    entryPointStatic = entryPoint.connect(AddressZero);

    deployer = ethersSigner[0];
    offchainSigner = ethersSigner[1];
    depositorSigner = ethersSigner[2];
    walletOwner = deployer; // ethersSigner[3];

    const addresses = await ethers.provider.listAccounts();
    // const ethersSigner = ethers.provider.getSigner();

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();
    // const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

    const offchainSignerAddress = await offchainSigner.getAddress();
    const walletOwnerAddress = await walletOwner.getAddress();

    verifyingSingletonPaymaster =
      await new VerifyingSingletonPaymaster__factory(deployer).deploy(
        await deployer.getAddress(),
        entryPoint.address,
        offchainSignerAddress
      );

    const DefaultHandler = await ethers.getContractFactory(
      "DefaultCallbackHandler"
    );
    handler = await DefaultHandler.deploy();
    await handler.deployed();
    console.log("Default callback handler deployed at: ", handler.address);

    const BaseImplementation = await ethers.getContractFactory("SmartAccount");
    baseImpl = await BaseImplementation.deploy(entryPoint.address);
    await baseImpl.deployed();
    console.log("base wallet impl deployed at: ", baseImpl.address);

    const WalletFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    walletFactory = await WalletFactory.deploy();
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

    await walletFactory.deployCounterFactualWallet(
      baseImpl.address,
      handler.address,
      walletOwnerAddress,
      0
    );
    const expected = await walletFactory.getAddressForCounterfactualWallet(
      baseImpl.address,
      handler.address,
      walletOwnerAddress,
      0
    );

    walletAddress = expected;
    console.log(" wallet address ", walletAddress);

    paymasterAddress = verifyingSingletonPaymaster.address;
    console.log("Paymaster address is ", paymasterAddress);

    /* await verifyingSingletonPaymaster
      .connect(deployer)
      .addStake(0, { value: parseEther("2") });
    console.log("paymaster staked"); */

    await entryPoint.depositTo(paymasterAddress, { value: parseEther("1") });

    // const resultSet = await entryPoint.getDepositInfo(paymasterAddress);
    // console.log("deposited state ", resultSet);
  });

  async function getUserOpWithPaymasterInfo(paymasterId: string) {
    const userOp1 = await fillAndSign(
      {
        sender: walletAddress,
      },
      walletOwner,
      entryPoint
    );

    const nonceFromContract = await verifyingSingletonPaymaster[
      "getSenderPaymasterNonce(address)"
    ](walletAddress);

    const nonceFromContract1 = await verifyingSingletonPaymaster[
      "getSenderPaymasterNonce((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes))"
    ](userOp1);

    expect(nonceFromContract).to.be.equal(nonceFromContract1);

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
      nonceFromContract.toNumber(),
      paymasterId
    );
    const sig = await offchainSigner.signMessage(arrayify(hash));
    const paymasterData = abi.encode(["address", "bytes"], [paymasterId, sig]);
    const paymasterAndData = hexConcat([paymasterAddress, paymasterData]);
    return await fillAndSign(
      {
        ...userOp1,
        paymasterAndData,
      },
      walletOwner,
      entryPoint
    );
  }

  it("succeed with valid signature", async () => {
    await verifyingSingletonPaymaster.depositFor(
      await offchainSigner.getAddress(),
      { value: ethers.utils.parseEther("1") }
    );
    const userOp1 = await fillAndSign(
      {
        sender: walletAddress,
        verificationGasLimit: 200000,
      },
      walletOwner,
      entryPoint
    );

    const nonceFromContract = await verifyingSingletonPaymaster[
      "getSenderPaymasterNonce(address)"
    ](walletAddress);

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
      nonceFromContract.toNumber(),
      await offchainSigner.getAddress()
    );
    const sig = await offchainSigner.signMessage(arrayify(hash));
    const userOp = await fillAndSign(
      {
        ...userOp1,
        paymasterAndData: hexConcat([
          paymasterAddress,
          ethers.utils.defaultAbiCoder.encode(
            ["address", "bytes"],
            [await offchainSigner.getAddress(), sig]
          ),
        ]),
      },
      walletOwner,
      entryPoint
    );
    console.log(userOp);
    await entryPoint.handleOps([userOp], await offchainSigner.getAddress());
    await expect(
      entryPoint.handleOps([userOp], await offchainSigner.getAddress())
    ).to.be.reverted;
  });

  it("can enable modules and accept transactions from it", async function () {
    await accounts[1].sendTransaction({
      from: bob,
      to: walletAddress,
      value: ethers.utils.parseEther("5"),
    });

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      walletAddress
    );

    await token
      .connect(accounts[0])
      .transfer(walletAddress, ethers.utils.parseEther("100"));

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
    // invoking safe from module without enabling it!
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

  it("succeed with valid signature send value transaction", async () => {
    await verifyingSingletonPaymaster.depositFor(
      await offchainSigner.getAddress(),
      { value: ethers.utils.parseEther("1") }
    );

    await accounts[1].sendTransaction({
      from: bob,
      to: walletAddress,
      value: ethers.utils.parseEther("5"),
    });

    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
      charlie,
      ethers.utils.parseEther("1"),
      "0x",
    ]);

    // const smartAccountCallData = "0x";
    const userOp1 = await fillAndSign(
      {
        sender: walletAddress,
        callData: txnData,
        verificationGasLimit: 200000,
      },
      walletOwner,
      entryPoint
    );

    const nonceFromContract = await verifyingSingletonPaymaster[
      "getSenderPaymasterNonce(address)"
    ](walletAddress);

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
      nonceFromContract.toNumber(),
      await offchainSigner.getAddress()
    );
    const sig = await offchainSigner.signMessage(arrayify(hash));
    const userOp = await fillAndSign(
      {
        ...userOp1,
        paymasterAndData: hexConcat([
          paymasterAddress,
          ethers.utils.defaultAbiCoder.encode(
            ["address", "bytes"],
            [await offchainSigner.getAddress(), sig]
          ),
        ]),
      },
      walletOwner,
      entryPoint
    );
    console.log(userOp);
    await entryPoint.handleOps([userOp], await offchainSigner.getAddress());
    await expect(
      entryPoint.handleOps([userOp], await offchainSigner.getAddress())
    ).to.be.reverted;
  });

  it("succeed with valid signature and module transaction", async () => {
    await verifyingSingletonPaymaster.depositFor(
      await offchainSigner.getAddress(),
      { value: ethers.utils.parseEther("1") }
    );

    await token
      .connect(accounts[0])
      .transfer(walletAddress, ethers.utils.parseEther("100"));

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      walletAddress
    );

    await accounts[1].sendTransaction({
      from: bob,
      to: walletAddress,
      value: ethers.utils.parseEther("5"),
    });

    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const WhitelistModule = await ethers.getContractFactory("WhitelistModule");
    const whitelistModule: WhitelistModule = await WhitelistModule.deploy(bob);
    console.log("Test module deployed at ", whitelistModule.address);

    // whitelisting target contract
    await whitelistModule
      .connect(accounts[1])
      .whitelistDestination(token.address);

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

    console.log("enabled module");
    console.log("wallet address ", walletAddress);

    const txnDataModule = WhitelistModule.interface.encodeFunctionData(
      "authCall",
      [
        walletAddress,
        token.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      ]
    );

    console.log("data for authCall");

    const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
      whitelistModule.address,
      ethers.utils.parseEther("0"),
      txnDataModule,
    ]);

    console.log("data for executeCall");

    // const smartAccountCallData = "0x";
    const userOp1 = await fillAndSign(
      {
        sender: walletAddress,
        callData: txnData,
        verificationGasLimit: 5000000,
      },
      walletOwner,
      entryPoint
    );

    const nonceFromContract = await verifyingSingletonPaymaster[
      "getSenderPaymasterNonce(address)"
    ](walletAddress);

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
      nonceFromContract.toNumber(),
      await offchainSigner.getAddress()
    );
    const sig = await offchainSigner.signMessage(arrayify(hash));
    const userOp = await fillAndSign(
      {
        ...userOp1,
        paymasterAndData: hexConcat([
          paymasterAddress,
          ethers.utils.defaultAbiCoder.encode(
            ["address", "bytes"],
            [await offchainSigner.getAddress(), sig]
          ),
        ]),
      },
      walletOwner,
      entryPoint
    );
    console.log(userOp);
    await entryPoint.handleOps([userOp], await offchainSigner.getAddress(), {
      gasLimit: 10000000,
    });
    /* await expect(
      entryPoint.handleOps([userOp], await offchainSigner.getAddress())
    ).to.be.reverted; */
  });
});
