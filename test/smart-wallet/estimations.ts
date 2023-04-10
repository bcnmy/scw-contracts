/* eslint-disable node/no-unsupported-features/es-syntax */
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
  SmartAccount,
  SmartAccountFactory,
  EntryPoint__factory,
  VerifyingSingletonPaymaster__factory,
  EntryPoint,
  VerifyingSingletonPaymaster,
  MockToken,
  MultiSend,
  StorageSetter,
  DefaultCallbackHandler,
} from "../../typechain";
import { fillAndSign } from "../utils/userOp";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";
import {
  FeeRefund,
  SafeTransaction,
  buildSafeTransaction,
  safeSignTypedData,
  Transaction,
} from "../../src/utils/execution";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

describe("Account Functionality: 4337", function () {
  let entryPoint: EntryPoint;
  let walletOwner: Signer;
  // let whitelistModule: WhitelistModule;
  let walletAddress: string, paymasterAddress: string;
  let ethersSigner;

  let offchainSigner: Signer, deployer: Signer;

  let verifyingSingletonPaymaster: VerifyingSingletonPaymaster;
  let baseImpl: SmartAccount;
  let walletFactory: SmartAccountFactory;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let owner: string;
  let bob: string;
  let charlie: string;
  let john: string;
  let dave: string;
  let userSCW: any;
  let handler: DefaultCallbackHandler;
  let accounts: any;
  let erc20Interface: any;
  const results: any = [];

  before(async () => {
    accounts = await ethers.getSigners();
    ethersSigner = await ethers.getSigners();
    entryPoint = await deployEntryPoint();

    deployer = ethersSigner[0];
    offchainSigner = ethersSigner[1];
    walletOwner = deployer;

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();
    john = await accounts[3].getAddress();
    dave = await accounts[4].getAddress();

    erc20Interface = new ethers.utils.Interface([
      "function transfer(address _to, uint256 _value)",
    ]);

    const offchainSignerAddress = await offchainSigner.getAddress();
    const walletOwnerAddress = await walletOwner.getAddress();

    verifyingSingletonPaymaster =
      await new VerifyingSingletonPaymaster__factory(deployer).deploy(
        await deployer.getAddress(),
        entryPoint.address,
        offchainSignerAddress
      );

    /* const DefaultHandler = await ethers.getContractFactory(
      "DefaultCallbackHandler"
    );
    handler = await DefaultHandler.deploy();
    await handler.deployed(); */

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

    const tx = await walletFactory.deployCounterFactualAccount(
      walletOwnerAddress,
      0
    );
    const expected = await walletFactory.getAddressForCounterFactualAccount(
      walletOwnerAddress,
      0
    );
    walletAddress = expected;
    const receipt = await tx.wait();
    // console.log("------------- Deploy SmartAccount Gas Used -------------");
    // console.log("SmartAccount: ", receipt.gasUsed.toString());
    results.push(`Deploy SmartAccount Gas Used: ${receipt.gasUsed.toString()}`);

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      expected
    );
    const entryPointAddress = await userSCW.entryPoint();
    expect(entryPointAddress).to.equal(entryPoint.address);

    paymasterAddress = verifyingSingletonPaymaster.address;

    await entryPoint.depositTo(paymasterAddress, { value: parseEther("1") });
  });

  it("4337 flow: estimate [send erc20] (wallet already deployed): transaction gasUsed", async () => {
    // deposit for the pasymaster
    await verifyingSingletonPaymaster.depositFor(
      await offchainSigner.getAddress(),
      { value: ethers.utils.parseEther("1") }
    );

    // transfer erc20 token to the wallet
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    // Encode an ERC-20 token transfer to recipient of the specified amount
    const transferData = erc20Interface.encodeFunctionData("transfer", [
      bob,
      ethers.utils.parseEther("1"),
    ]);
    // encode executeCall function data with transfer erc20 token data
    const txnData = SmartAccount.interface.encodeFunctionData(
      "executeCall_s1m",
      [token.address, 0, transferData]
    );

    const userOp1 = await fillAndSign(
      {
        sender: walletAddress,
        callData: txnData,
        verificationGasLimit: 200000,
      },
      walletOwner,
      entryPoint,
      "nonce"
    );

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
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
      entryPoint,
      "nonce"
    );

    const tx = await entryPoint.handleOps(
      [userOp],
      await offchainSigner.getAddress()
    );
    const receipt = await tx.wait();
    // console.log(
    //   "--------AA 4337 flow: [Send erc20] tx executeCall: ",
    //   receipt.gasUsed.toNumber(),
    //   "--------"
    // );
    results.push(
      `AA 4337 flow: [Send erc20] tx executeCall: ${receipt.gasUsed.toString()}`
    );

    // check updated balance of the wallet and bob
    const balanceSCW = await token.balanceOf(userSCW.address);
    const balanceBob = await token.balanceOf(bob);
    expect(balanceSCW).to.equal(ethers.utils.parseEther("99"));
    expect(balanceBob).to.equal(ethers.utils.parseEther("1"));
  });

  it("4337 flow: estimate [wallet deployment + send erc20]: transaction gasUsed", async () => {
    // create new SCW but dont deployCounterFactualAccount
    const SmartAccount = await ethers.getContractFactory("SmartAccount");
    const expectedWallet =
      await walletFactory.getAddressForCounterFactualAccount(charlie, 10);

    const newUserSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      expectedWallet
    );

    // transfer erc20 token to the new wallet
    await token
      .connect(accounts[0])
      .transfer(newUserSCW.address, ethers.utils.parseEther("100"));

    // Encode an ERC-20 token transfer to recipient of the specified amount
    const transferData = erc20Interface.encodeFunctionData("transfer", [
      bob,
      ethers.utils.parseEther("1"),
    ]);
    // encode executeCall function data with transfer erc20 token data
    const txnData = SmartAccount.interface.encodeFunctionData(
      "executeCall_s1m",
      [token.address, 0, transferData]
    );

    const WalletFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );

    const encodedData = WalletFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [charlie, 10]
    );

    const userOp1 = await fillAndSign(
      {
        sender: newUserSCW.address,
        callData: txnData,
        verificationGasLimit: 900000,
        // nonce: 0,
        initCode: hexConcat([walletFactory.address, encodedData]),
      },
      accounts[2],
      entryPoint,
      "nonce"
    );

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
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
      accounts[2],
      entryPoint,
      "nonce"
    );

    const tx = await entryPoint.handleOps(
      [userOp],
      await offchainSigner.getAddress()
    );
    const receipt = await tx.wait();

    // console.log(
    //   "--------AA 4337 flow: [Wallet Deploy + Send erc20] tx executeCall: ",
    //   receipt.gasUsed.toNumber(),
    //   "--------"
    // );
    results.push(
      `AA 4337 flow: [Wallet Deploy + Send erc20] tx executeCall: ${receipt.gasUsed.toString()}`
    );

    // check updated balance of the wallet and bob
    const balanceSCW = await token.balanceOf(newUserSCW.address);
    const balanceBob = await token.balanceOf(bob);
    expect(balanceSCW).to.equal(ethers.utils.parseEther("99"));
    expect(balanceBob).to.equal(ethers.utils.parseEther("2"));
  });

  it("4337 flow: estimate [send erc20 batch] (wallet already deployed): transaction gasUsed", async () => {
    const SmartAccount = await ethers.getContractFactory("SmartAccount");
    await walletFactory.deployCounterFactualAccount(charlie, 11);
    const expectedWallet =
      await walletFactory.getAddressForCounterFactualAccount(charlie, 11);

    const newUserSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      expectedWallet
    );

    // transfer erc20 token to the new wallet
    await token
      .connect(accounts[0])
      .transfer(newUserSCW.address, ethers.utils.parseEther("100"));

    // Encode an ERC-20 token transfer to recipient of the specified amount
    const transferData1 = erc20Interface.encodeFunctionData("transfer", [
      john,
      ethers.utils.parseEther("1"),
    ]);
    const transferData2 = erc20Interface.encodeFunctionData("transfer", [
      dave,
      ethers.utils.parseEther("1"),
    ]);
    // encode executeCall function data with transfer erc20 token data
    const txnData = SmartAccount.interface.encodeFunctionData(
      "executeBatchCall_4by",
      [
        [token.address, token.address],
        [0, 0],
        [transferData1, transferData2],
      ]
    );

    const userOp1 = await fillAndSign(
      {
        sender: newUserSCW.address,
        callData: txnData,
        // verificationGasLimit: 900000,
        // nonce: 0,
        // initCode: hexConcat([walletFactory.address, encodedData]),
      },
      accounts[2],
      entryPoint,
      "nonce"
    );

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
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
      accounts[2],
      entryPoint,
      "nonce"
    );

    const tx = await entryPoint.handleOps(
      [userOp],
      await offchainSigner.getAddress()
    );
    const receipt = await tx.wait();
    // console.log(
    //   "--------AA 4337 flow: [Send erc20 batch] tx executeBatchCall:",
    //   receipt.gasUsed.toNumber(),
    //   "--------"
    // );
    results.push(
      `AA 4337 flow: [Send erc20 batch] tx executeBatchCall: ${receipt.gasUsed.toString()}`
    );

    // check updated balance of the wallet and bob
    const balanceSCW = await token.balanceOf(newUserSCW.address);
    const balanceJohn = await token.balanceOf(john);
    const balanceDave = await token.balanceOf(dave);
    expect(balanceSCW).to.equal(ethers.utils.parseEther("98"));
    expect(balanceJohn).to.equal(ethers.utils.parseEther("1"));
    expect(balanceDave).to.equal(ethers.utils.parseEther("1"));
  });

  it("4337 flow: estimate [wallet deployment + send erc20 batch]: transaction gasUsed", async () => {
    // create new SCW but dont deployCounterFactualAccount
    const SmartAccount = await ethers.getContractFactory("SmartAccount");
    const expectedWallet =
      await walletFactory.getAddressForCounterFactualAccount(charlie, 12);
    const newUserSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      expectedWallet
    );

    // transfer erc20 token to the new wallet
    await token
      .connect(accounts[0])
      .transfer(expectedWallet, ethers.utils.parseEther("100"));

    // Encode an ERC-20 token transfer to recipient of the specified amount
    const transferData1 = erc20Interface.encodeFunctionData("transfer", [
      john,
      ethers.utils.parseEther("1"),
    ]);
    const transferData2 = erc20Interface.encodeFunctionData("transfer", [
      dave,
      ethers.utils.parseEther("1"),
    ]);
    // encode executeCall function data with transfer erc20 token data
    const txnData = SmartAccount.interface.encodeFunctionData(
      "executeBatchCall_4by",
      [
        [token.address, token.address],
        [0, 0],
        [transferData1, transferData2],
      ]
    );

    const WalletFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );

    const encodedData = WalletFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [charlie, 12]
    );

    const userOp1 = await fillAndSign(
      {
        sender: newUserSCW.address,
        callData: txnData,
        verificationGasLimit: 9000000,
        // nonce: 0,
        callGasLimit: 500000,
        initCode: hexConcat([walletFactory.address, encodedData]),
      },
      accounts[2],
      entryPoint,
      "nonce"
    );

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
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
      accounts[2],
      entryPoint,
      "nonce"
    );

    const tx = await entryPoint.handleOps(
      [userOp],
      await offchainSigner.getAddress()
    );
    const receipt = await tx.wait();
    // console.log(
    //   "--------AA 4337 flow: [wallet deployment + send erc20 batch] tx executeBatchCall:",
    //   receipt.gasUsed.toNumber(),
    //   "--------"
    // );
    results.push(
      `AA 4337 flow: [wallet deployment + send erc20 batch] tx executeBatchCall: ${receipt.gasUsed.toString()}`
    );

    // check updated balance of the wallet and bob
    const balanceSCW = await token.balanceOf(expectedWallet);
    const balanceJohn = await token.balanceOf(john);
    const balanceDave = await token.balanceOf(dave);
    expect(balanceSCW).to.equal(ethers.utils.parseEther("98"));
    expect(balanceJohn).to.equal(ethers.utils.parseEther("2"));
    expect(balanceDave).to.equal(ethers.utils.parseEther("2"));
  });

  // Note : above results are when EP and Paymaster computation is involved!
  // Should do tests without paymaster (waller has native eth / pre deposited in entry point) and also below tests
  it("Owner flow: estimate [send erc20 / erc20 batch] (wallet already deployed): transaction gasUsed", async () => {
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    // Encode an ERC-20 token transfer to recipient of the specified amount
    const transferData1 = erc20Interface.encodeFunctionData("transfer", [
      john,
      ethers.utils.parseEther("1"),
    ]);
    let tx = await userSCW
      .connect(accounts[0])
      .executeCall_s1m(token.address, 0, transferData1);
    let receipt = await tx.wait();
    // console.log(
    //   "--------Owner flow: [send erc20] tx executeCall:",
    //   receipt.gasUsed.toNumber(),
    //   "--------"
    // );
    results.push(
      `Owner flow: [send erc20] tx executeCall: ${receipt.gasUsed.toString()}`
    );
    expect(await token.balanceOf(john)).to.equal(ethers.utils.parseEther("3"));

    // Encode an ERC-20 token transfer to recipient of the specified amount
    const transferData2 = erc20Interface.encodeFunctionData("transfer", [
      dave,
      ethers.utils.parseEther("1"),
    ]);
    tx = await userSCW
      .connect(accounts[0])
      .executeBatchCall_4by(
        [token.address, token.address],
        [0, 0],
        [transferData1, transferData2]
      );
    receipt = await tx.wait();
    // console.log(
    //   "--------Owner flow: [send erc20] tx executeBatchCall:",
    //   receipt.gasUsed.toNumber(),
    //   "--------"
    // );
    results.push(
      `Owner flow: [send erc20] tx executeBatchCall: ${receipt.gasUsed.toString()}`
    );

    expect(await token.balanceOf(john)).to.equal(ethers.utils.parseEther("4"));
    expect(await token.balanceOf(dave)).to.equal(ethers.utils.parseEther("3"));
  });

  // Todo // ERC20 transfer and ERC20 batch transfer but using owner signature via execTransaction

  it("Forward flow: estimate [send erc20] (wallet already deployed): transaction gasUsed", async () => {
    // balance before transfer john-4, scw - 200

    const transferData = erc20Interface.encodeFunctionData("transfer", [
      john,
      ethers.utils.parseEther("1"),
    ]);
    const safeTx: SafeTransaction = buildSafeTransaction({
      to: token.address,
      data: transferData,
      nonce: await userSCW.getNonce(1),
    });

    const gasEstimate = await ethers.provider.estimateGas({
      to: token.address,
      data: transferData,
      from: userSCW.address,
    });

    const chainId = await userSCW.getChainId();

    safeTx.refundReceiver = "0x0000000000000000000000000000000000000000";
    safeTx.gasToken = token.address;
    safeTx.gasPrice = 1000000000000; // this would be token gas price
    safeTx.targetTxGas = gasEstimate.toNumber();
    safeTx.baseGas = 21000 + gasEstimate.toNumber() - 21000; // base plus erc20 token transfer
    const { data } = await safeSignTypedData(
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
      tokenGasPriceFactor: safeTx.tokenGasPriceFactor,
      gasToken: safeTx.gasToken,
      refundReceiver: safeTx.refundReceiver,
    };

    const tx = await userSCW
      .connect(accounts[1])
      .execTransaction_S6W(transaction, refundInfo, signature, {
        gasPrice: safeTx.gasPrice,
      });
    const receipt = await tx.wait();
    // console.log(
    //   "--------Forward flow: [send erc20] tx execTransaction_S6W:",
    //   receipt.gasUsed.toNumber(),
    //   "--------"
    // );
    results.push(
      `Forward flow: [send erc20] tx execTransaction_S6W: ${receipt.gasUsed.toString()}`
    );

    console.log(await token.balanceOf(john));
    expect(await token.balanceOf(john)).to.equal(ethers.utils.parseEther("5"));
  });

  // log results
  it("Gas results", async () => {
    console.log("--------Gas results--------");
    results.forEach((result: string) => {
      console.log(result);
    });
  });
});
