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

describe("Account Functionality: 4337", function () {
  let entryPoint: EntryPoint;
  let entryPointStatic: EntryPoint;
  let depositorSigner: Signer;
  let walletOwner: Signer;
  // let whitelistModule: WhitelistModule;
  let walletAddress: string, paymasterAddress: string;
  let ethersSigner;

  let offchainSigner: Signer, deployer: Signer;

  let verifyingSingletonPaymaster: VerifyingSingletonPaymaster;
  let baseImpl: SmartWallet;
  let walletFactory: WalletFactory;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let owner: string;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  let handler: DefaultCallbackHandler;
  let accounts: any;

  beforeEach(async () => {
    accounts = await ethers.getSigners();

    ethersSigner = await ethers.getSigners();
    entryPoint = await deployEntryPoint();
    entryPointStatic = entryPoint.connect(AddressZero);

    deployer = ethersSigner[0];
    offchainSigner = ethersSigner[1];
    depositorSigner = ethersSigner[2];
    walletOwner = deployer;

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();

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

    const initializer = BaseImplementation.interface.encodeFunctionData(
      "init",
      [walletOwnerAddress, handler.address]
    );

    await walletFactory.deployCounterFactualWallet(
      baseImpl.address,
      initializer,
      0
    );
    const expected = await walletFactory.getAddressForCounterfactualWallet(
      baseImpl.address,
      initializer,
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

  it("4337 flow: succeed with valid signature send value transaction", async () => {
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

  it("4337 flow: succeed with valid signature to update owner", async () => {
    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      walletAddress
    );

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

    // creating data and dataHash signed by owner
    const newOwner = accounts[5];
    const swapOwnerData = SmartAccount.interface.encodeFunctionData(
      "setOwner",
      [newOwner.address]
    );

    const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
      walletAddress,
      ethers.utils.parseEther("0"),
      swapOwnerData,
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

    console.log(
      "newOner should be",
      newOwner.address,
      "and is",
      await userSCW.owner()
    );
    // check if owner is updated
    expect(await userSCW.owner()).to.equal(newOwner.address);

    await expect(
      entryPoint.handleOps([userOp], await offchainSigner.getAddress())
    ).to.be.reverted;
  });

  it("4337 flow: should not be able to set implementation from executeCall() / execFromEntryPoint() method of AA flow", async () => {
    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      walletAddress
    );

    entryPoint = await deployEntryPoint();

    const BaseImplementation2 = await ethers.getContractFactory(
      "SmartAccount2"
    );
    const baseImpl2 = await BaseImplementation2.deploy(entryPoint.address);
    await baseImpl2.deployed();
    console.log("base wallet upgraded impl deployed at: ", baseImpl2.address);

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

    const updateImplementationData = SmartAccount.interface.encodeFunctionData(
      "updateImplementation",
      [baseImpl2.address]
    );

    const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
      walletAddress,
      ethers.utils.parseEther("0"),
      updateImplementationData,
    ]);

    console.log("transaction data ", txnData);

    // const smartAccountCallData = "0x";
    const userOp1 = await fillAndSign(
      {
        sender: walletAddress,
        callData: txnData,
        verificationGasLimit: 200000,
        callGasLimit: 200000,
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

    await expect(
      entryPoint.handleOps([userOp], await offchainSigner.getAddress())
    ).to.be.reverted;
  });

  it("4337 flow: should be able to set implementation to new one", async () => {
    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      walletAddress
    );

    const priorEntryPoint = await userSCW.entryPoint();
    console.log("prior entrypoint ", priorEntryPoint);

    console.log(entryPoint.address);

    const newEntryPoint = await deployEntryPoint();

    console.log("deployed entrypoint again ", newEntryPoint.address);

    const BaseImplementation2 = await ethers.getContractFactory(
      "SmartAccount2"
    );
    const baseImpl2 = await BaseImplementation2.deploy(newEntryPoint.address);
    await baseImpl2.deployed();

    console.log("implementation would have this storage..");
    console.log(await baseImpl2.entryPoint());

    console.log("base wallet upgraded impl deployed at: ", baseImpl2.address);

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

    const txnData = SmartAccount.interface.encodeFunctionData(
      "updateImplementation",
      [baseImpl2.address]
    );

    console.log("transaction data ", txnData);

    // const smartAccountCallData = "0x";
    const userOp1 = await fillAndSign(
      {
        sender: walletAddress,
        callData: txnData,
        verificationGasLimit: 200000,
        // callGasLimit: 200000,
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

    const latestEntryPoint = await userSCW.entryPoint();
    console.log("latest entrypoint ", latestEntryPoint);

    expect(latestEntryPoint).to.be.equal(newEntryPoint.address);

    // Transaction after updating implementation

    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      // value: ethers.utils.parseEther("1"),
      data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
      nonce: await userSCW.getNonce(1),
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
