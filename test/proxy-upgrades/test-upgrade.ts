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
import { encodeTransfer } from "../smart-wallet/testUtils";
import {
  SafeTransaction,
  Transaction,
  FeeRefund,
  safeSignTypedData,
  buildSafeTransaction,
} from "../../src/utils/execution";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

describe("Upgradeability: test-upgrade", function () {
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

  it("should deploy new implementation and upgrade", async function () {
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
    console.log("base wallet upgraded impl deployed at: ", baseImpl2.address);

    await expect(
      userSCW.connect(accounts[0]).updateImplementation(baseImpl2.address)
    ).to.emit(userSCW, "ImplementationUpdated");

    // Shouldn't we have to initialise again?
    // Gnosis example to upgrade using this contract
    // https://github.com/safe-global/safe-contracts/blob/main/contracts/examples/libraries/Migrate_1_3_0_to_1_2_0.sol

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/test/upgrades/SmartAccount2.sol:SmartAccount2",
      userSCW.address
    );
  });

  // Transactions
  it("Should send basic transactions from SCW to external contracts", async function () {
    console.log("sending tokens to the safe..");
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const data = encodeTransfer(bob, ethers.utils.parseEther("10").toString());
    const tx = await userSCW
      .connect(accounts[0])
      .executeCall_s1m(token.address, ethers.utils.parseEther("0"), data);
    const receipt = await tx.wait();
    console.log(receipt.transactionHash);

    expect(await token.balanceOf(bob)).to.equal(ethers.utils.parseEther("10"));

    // executeBatch
    const data2 = encodeTransfer(
      charlie,
      ethers.utils.parseEther("10").toString()
    );
    await userSCW
      .connect(accounts[0])
      .executeBatchCall_4by(
        [token.address, token.address],
        [ethers.utils.parseEther("0"), ethers.utils.parseEther("0")],
        [data, data2]
      );

    expect(await token.balanceOf(bob)).to.equal(ethers.utils.parseEther("20"));
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
        .execTransaction_S6W(transaction, refundInfo, signature)
    ).to.emit(userSCW, "ExecutionSuccess");

    expect(await token.balanceOf(charlie)).to.equal(
      ethers.utils.parseEther("10")
    );
  });
});
