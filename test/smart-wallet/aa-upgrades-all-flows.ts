import { expect } from "chai";
import { ethers } from "hardhat";
import {
  SmartAccount,
  SmartAccountFactory,
  EntryPoint,
  EntryPoint__factory,
  VerifyingSingletonPaymaster,
  VerifyingSingletonPaymaster__factory,
  MockToken,
  MultiSend,
  StorageSetter,
  DefaultCallbackHandler,
} from "../../typechain";
import {
  SafeTransaction,
  Transaction,
  FeeRefund,
  safeSignTypedData,
  buildSafeTransaction,
} from "../../src/utils/execution";
import { encodeTransfer } from "./testUtils";
import { fillAndSign } from "../utils/userOp";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";
import { Signer } from "ethers";
import { UserOperation } from "../utils/userOpetation";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

async function getUserOpWithPaymasterData(
  paymaster: VerifyingSingletonPaymaster,
  smartAccountAddress: any,
  userOp: UserOperation,
  offchainPaymasterSigner: Signer,
  paymasterAddress: string,
  walletOwner: Signer,
  entryPoint: EntryPoint
) {
  const hash = await paymaster.getHash(
    userOp,
    await offchainPaymasterSigner.getAddress()
  );
  const sig = await offchainPaymasterSigner.signMessage(arrayify(hash));
  const userOpWithPaymasterData = await fillAndSign(
    {
      // eslint-disable-next-line node/no-unsupported-features/es-syntax
      ...userOp,
      paymasterAndData: hexConcat([
        paymasterAddress,
        ethers.utils.defaultAbiCoder.encode(
          ["address", "bytes"],
          [await offchainPaymasterSigner.getAddress(), sig]
        ),
      ]),
    },
    walletOwner,
    entryPoint,
    "nonce"
  );
  return userOpWithPaymasterData;
}

describe("Upgrade functionality Via Entrypoint", function () {
  let entryPoint: EntryPoint;
  let latestEntryPoint: EntryPoint;
  let walletOwner: Signer;
  let paymasterAddress: string;
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
  let userSCW: any;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();
    entryPoint = await deployEntryPoint();

    deployer = accounts[0];
    offchainSigner = accounts[1];
    walletOwner = deployer;

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();

    const offchainSignerAddress = await offchainSigner.getAddress();

    verifyingSingletonPaymaster =
      await new VerifyingSingletonPaymaster__factory(deployer).deploy(
        await deployer.getAddress(),
        entryPoint.address,
        offchainSignerAddress
      );

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

    paymasterAddress = verifyingSingletonPaymaster.address;
    console.log("Paymaster address is ", paymasterAddress);

    await verifyingSingletonPaymaster
      .connect(deployer)
      .addStake(10, { value: parseEther("2") });
    console.log("paymaster staked");

    await verifyingSingletonPaymaster.depositFor(
      await offchainSigner.getAddress(),
      { value: ethers.utils.parseEther("1") }
    );

    await entryPoint.depositTo(paymasterAddress, { value: parseEther("10") });
  });

  describe("Basic Userops using Entrypoint", function () {
    it("succeed with valid signature", async () => {
      // deploying wallet first
      await walletFactory.deployCounterFactualAccount(owner, 0);
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          verificationGasLimit: 350000,
        },
        walletOwner,
        entryPoint,
        "nonce"
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        paymasterAddress,
        walletOwner,
        entryPoint
      );
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());
      await expect(
        entryPoint.handleOps([userOp], await offchainSigner.getAddress())
      ).to.be.reverted;
    });

    it("4337 flow: succeed with valid signature send value transaction", async () => {
      // Now the wallet with owner and index 0 is deployed!

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      // May use
      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      await accounts[1].sendTransaction({
        from: bob,
        to: expectedSmartAccountAddress,
        value: ethers.utils.parseEther("5"),
      });

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const charlieBalBefore = await ethers.provider.getBalance(charlie);

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        charlie,
        ethers.utils.parseEther("1"),
        "0x",
      ]);

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnData,
          verificationGasLimit: 200000,
        },
        walletOwner,
        entryPoint,
        "nonce"
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        paymasterAddress,
        walletOwner,
        entryPoint
      );
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());
      await expect(
        entryPoint.handleOps([userOp], await offchainSigner.getAddress())
      ).to.be.reverted;

      const balActual = await ethers.provider.getBalance(charlie);
      expect(balActual).to.be.equal(
        charlieBalBefore.add(ethers.utils.parseEther("1"))
      );
    });
  });

  describe("setOwner(mixedAuth) functionality via Entrypoint flow", function () {
    it("4337 flow: succeed with valid signature to update owner", async () => {
      // // Now here also the wallet with owner and index 0 should have been deployed

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      const code = await ethers.provider.getCode(expectedSmartAccountAddress);
      console.log("wallet code is: ", code);

      // May use!
      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      // creating data and dataHash signed by owner
      const newOwner = accounts[5];
      const swapOwnerData = SmartAccount.interface.encodeFunctionData(
        "setOwner",
        [newOwner.address]
      );

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        expectedSmartAccountAddress,
        ethers.utils.parseEther("0"),
        swapOwnerData,
      ]);

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnData,
          verificationGasLimit: 200000,
        },
        walletOwner,
        entryPoint,
        "nonce"
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        paymasterAddress,
        walletOwner,
        entryPoint
      );
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
  });

  describe("Upgrades using Entrypoint: Already Deployed Account", function () {
    // so far so good!
    it("4337 flow: should be able to set implementation from executeCall() method of AA flow", async () => {
      // Now the wallet with owner and index 0 is deployed!

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      console.log("account ", expectedSmartAccountAddress);

      // May use
      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      // let's just update implementation on already deployed wallet

      const priorEntryPoint = await userSCW.entryPoint();
      console.log("prior entrypoint ", priorEntryPoint);

      expect(priorEntryPoint).to.be.equal(entryPoint.address);

      const newEntryPoint = await deployEntryPoint();
      console.log("latest entrypoint ", newEntryPoint.address);

      const BaseImplementation11 = await ethers.getContractFactory(
        "SmartAccount11"
      );
      const baseImpl11 = await BaseImplementation11.deploy(
        newEntryPoint.address
      );
      await baseImpl11.deployed();
      console.log("base wallet new impl deployed at: ", baseImpl11.address);

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const updateImplementationData =
        SmartAccount.interface.encodeFunctionData("updateImplementation", [
          baseImpl11.address,
        ]);

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        expectedSmartAccountAddress,
        ethers.utils.parseEther("0"),
        updateImplementationData,
      ]);

      console.log("transaction data ", txnData);

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnData,
          // verificationGasLimit: 200000,
          // callGasLimit: 1000000,
        },
        accounts[5], // since the owner has changed!
        entryPoint,
        "nonce"
      );
      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        paymasterAddress,
        accounts[5],
        entryPoint
      );

      // This action should send userOp that upgrades implementation on already deployed wallet!
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());

      const currentImpl = await userSCW.getImplementation();
      console.log("current implementation by querying: ", currentImpl);
      expect(currentImpl).to.be.equal(baseImpl11.address);

      // Not really needed
      /* userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/test/upgrades/SmartAccount11.sol:SmartAccount11",
        expected
      ); */

      const latestEntryPoint = await userSCW.entryPoint();
      console.log("current entrypoint ", latestEntryPoint);

      expect(latestEntryPoint).to.be.equal(newEntryPoint.address);
    });

    it("now sends the transaction through latest implementation", async () => {
      // Notice now owner is accounts[5] but to detect it we'd use owner (previous owner!) and index 0
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/test/upgrades/SmartAccount11.sol:SmartAccount11",
        expectedSmartAccountAddress
      );

      await token
        .connect(walletOwner)
        .transfer(expectedSmartAccountAddress, ethers.utils.parseEther("100"));

      const safeTx: SafeTransaction = buildSafeTransaction({
        to: token.address,
        // value: ethers.utils.parseEther("1"),
        data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
        nonce: await userSCW.getNonce(1),
      });

      const chainId = await userSCW.getChainId();
      const { signer, data } = await safeSignTypedData(
        accounts[5], // owner has changed!
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
          .connect(walletOwner)
          .execTransaction_S6W(transaction, refundInfo, signature)
      ).to.emit(userSCW, "ExecutionSuccess");

      expect(await token.balanceOf(charlie)).to.equal(
        ethers.utils.parseEther("10")
      );
    });

    it("should now reject any transactions from previous entry point!", async () => {
      // Todo
    });
  });

  describe("Upgrades using Entrypoint: UnDeployed Account", function () {
    // so far so good
    it("4337 flow: sends userOp with initcode and calldata to update implementation from blanket to new one!", async () => {
      // Now the wallet with owner and index 0 is deployed!
      // Notice now owner is accounts[5] but to detect it we'd use owner (previous owner!) and index 0
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      // anyway we will deploy a new one, so...
      const freshAccount =
        await walletFactory.getAddressForCounterFactualAccount(owner, 1);

      const codeBefore = await ethers.provider.getCode(freshAccount);
      console.log("wallet code before is: ", codeBefore);

      console.log("the wallet will be first deployed with entry point");

      // preserved now..
      latestEntryPoint = await deployEntryPoint();
      console.log("latest entrypoint ", latestEntryPoint.address);

      const BaseImplementation11 = await ethers.getContractFactory(
        "SmartAccount11"
      );
      const baseImpl11 = await BaseImplementation11.deploy(
        latestEntryPoint.address
      );
      await baseImpl11.deployed();
      console.log("base wallet new impl deployed at: ", baseImpl11.address);

      await accounts[1].sendTransaction({
        from: bob,
        to: freshAccount,
        value: ethers.utils.parseEther("5"),
      });

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const updateImplementationData =
        SmartAccount.interface.encodeFunctionData("updateImplementation", [
          baseImpl11.address,
        ]);

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        freshAccount,
        ethers.utils.parseEther("0"),
        updateImplementationData,
      ]);

      console.log("transaction data ", txnData);

      const WalletFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );

      const encodedData = WalletFactory.interface.encodeFunctionData(
        "deployCounterFactualAccount",
        [owner, 1]
      );

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: freshAccount,
          callData: txnData,
          initCode: hexConcat([walletFactory.address, encodedData]),
          verificationGasLimit: 400000,
          callGasLimit: 1000000,
        },
        walletOwner, // since the owner signer is supposed to be walletOwner
        entryPoint, // at this point original entrypoint should process userops
        "nonce"
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        freshAccount,
        userOp1,
        offchainSigner,
        paymasterAddress,
        walletOwner,
        entryPoint
      );

      // This action should send userOp that upgrades implementation on already deployed wallet!
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/test/upgrades/SmartAccount11.sol:SmartAccount11",
        freshAccount
      );

      /* userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        freshAccount
      ); */

      const currentImpl = await userSCW.getImplementation();
      console.log("current implementation by querying: ", currentImpl);
      expect(currentImpl).to.be.equal(baseImpl11.address);

      const currentEntryPoint = await userSCW.entryPoint();
      console.log("current entrypoint ", currentEntryPoint);
      expect(currentEntryPoint).to.be.equal(latestEntryPoint.address);

      const codeAfter = await ethers.provider.getCode(freshAccount);
      console.log("wallet code after is: ", codeAfter);
    });

    it("should now reject any trasactions from previous entry point", async () => {
      // Now here also the wallet with owner and index 1 should have been deployed
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 1);

      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          verificationGasLimit: 350000,
        },
        walletOwner, // rightful owner signer
        entryPoint, // previous entrypoint
        "nonce"
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        paymasterAddress,
        walletOwner,
        entryPoint
      );

      await expect(
        entryPoint.handleOps([userOp], await offchainSigner.getAddress())
      ).to.be.reverted;
    });

    it("should now accept trasactions from latest entry point", async () => {
      // Now here also the wallet with owner and index 1 should have been deployed
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 1);

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const charlieBalBefore = await ethers.provider.getBalance(charlie);

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        charlie,
        ethers.utils.parseEther("1"),
        "0x",
      ]);

      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnData,
          verificationGasLimit: 350000,
        },
        walletOwner, // rightful owner signer
        latestEntryPoint, // previous entrypoint
        "nonce"
      );

      // NOTICE: To use the latestEntryPoint now you mus make the deposits (migrate stakes and deposits!)
      // We also need to deploy new VerifyingSingletonPaymaster because the entry point is immutable!

      const verifyingSingletonPaymasterNew =
        await new VerifyingSingletonPaymaster__factory(deployer).deploy(
          await deployer.getAddress(),
          latestEntryPoint.address,
          await offchainSigner.getAddress()
        );

      await verifyingSingletonPaymasterNew
        .connect(deployer)
        .addStake(10, { value: parseEther("2") });
      console.log("new paymaster staked");

      await verifyingSingletonPaymasterNew.depositFor(
        await offchainSigner.getAddress(),
        { value: ethers.utils.parseEther("1") }
      );

      await latestEntryPoint.depositTo(verifyingSingletonPaymasterNew.address, {
        value: parseEther("10"),
      });

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymasterNew,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        verifyingSingletonPaymasterNew.address,
        walletOwner,
        latestEntryPoint
      );

      await latestEntryPoint.handleOps(
        [userOp],
        await offchainSigner.getAddress()
      );

      const balActual = await ethers.provider.getBalance(charlie);
      expect(balActual).to.be.equal(
        charlieBalBefore.add(ethers.utils.parseEther("1"))
      );
    });
  });

  describe("using Entrypoint: UnDeployed Account: Deploy and change handler/implementation", function () {
    // so far so good
    it("4337 flow: sends userOp with initcode and calldata to update implementation from blanket to new one!", async () => {
      // Now the wallet with owner and index 0 and 1 is deployed!

      // anyway we will deploy a new one, so...
      const freshAccount =
        await walletFactory.getAddressForCounterFactualAccount(owner, 2);

      const codeBefore = await ethers.provider.getCode(freshAccount);
      console.log("wallet code before is: ", codeBefore);

      console.log("the wallet will be first deployed with entry point");

      // preserved now..
      // latestEntryPoint = await deployEntryPoint();
      // console.log("latest entrypoint ", latestEntryPoint.address);

      const BaseImplementation11 = await ethers.getContractFactory(
        "SmartAccount11"
      );
      const baseImpl11 = await BaseImplementation11.deploy(entryPoint.address);
      await baseImpl11.deployed();
      console.log("base wallet new impl deployed at: ", baseImpl11.address);

      await accounts[1].sendTransaction({
        from: bob,
        to: freshAccount,
        value: ethers.utils.parseEther("5"),
      });

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const updateImplementationData =
        SmartAccount.interface.encodeFunctionData("updateImplementation", [
          baseImpl11.address,
        ]);

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        freshAccount,
        ethers.utils.parseEther("0"),
        updateImplementationData,
      ]);

      console.log("transaction data ", txnData);

      const WalletFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );

      const encodedData = WalletFactory.interface.encodeFunctionData(
        "deployCounterFactualAccount",
        [owner, 2]
      );

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: freshAccount,
          callData: txnData,
          initCode: hexConcat([walletFactory.address, encodedData]),
          verificationGasLimit: 400000,
          callGasLimit: 1000000,
        },
        walletOwner, // since the owner signer is supposed to be walletOwner
        entryPoint,
        "nonce"
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        freshAccount,
        userOp1,
        offchainSigner,
        paymasterAddress,
        walletOwner,
        entryPoint
      );

      // This action should send userOp that upgrades implementation on already deployed wallet!
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/test/upgrades/SmartAccount11.sol:SmartAccount11",
        freshAccount
      );

      /* userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        freshAccount
      ); */

      const currentImpl = await userSCW.getImplementation();
      console.log("current implementation by querying: ", currentImpl);
      expect(currentImpl).to.be.equal(baseImpl11.address);

      const currentEntryPoint = await userSCW.entryPoint();
      console.log("current entrypoint ", currentEntryPoint);
      expect(currentEntryPoint).to.be.equal(entryPoint.address);

      const codeAfter = await ethers.provider.getCode(freshAccount);
      console.log("wallet code after is: ", codeAfter);
    });

    it("4337 flow: sends userOp with initcode and calldata to update handler from minimal to new one!", async () => {
      // Now the wallet with owner and index 0 and 1 and 2 is deployed!

      // anyway we will deploy a new one, so...
      const freshAccount =
        await walletFactory.getAddressForCounterFactualAccount(owner, 3);

      const codeBefore = await ethers.provider.getCode(freshAccount);
      console.log("wallet code before is: ", codeBefore);

      console.log("the wallet will be first deployed with entry point");

      await accounts[1].sendTransaction({
        from: bob,
        to: freshAccount,
        value: ethers.utils.parseEther("5"),
      });

      // Let's deploy a new handler!
      const DefaultHandler = await ethers.getContractFactory(
        "DefaultCallbackHandler"
      );
      const handler = await DefaultHandler.deploy();
      await handler.deployed();
      console.log("Default callback handler deployed at: ", handler.address);

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      // setFallbackHandler is also mixedAuth!
      const updateHandlerData = SmartAccount.interface.encodeFunctionData(
        "setFallbackHandler",
        [handler.address]
      );

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        freshAccount,
        ethers.utils.parseEther("0"),
        updateHandlerData,
      ]);

      console.log("transaction data ", txnData);

      const WalletFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );

      const encodedData = WalletFactory.interface.encodeFunctionData(
        "deployCounterFactualAccount",
        [owner, 3]
      );

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: freshAccount,
          callData: txnData,
          initCode: hexConcat([walletFactory.address, encodedData]),
          verificationGasLimit: 400000,
          callGasLimit: 1000000,
        },
        walletOwner, // since the owner signer is supposed to be walletOwner
        entryPoint,
        "nonce"
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        freshAccount,
        userOp1,
        offchainSigner,
        paymasterAddress,
        walletOwner,
        entryPoint
      );

      // This action should send userOp that upgrades implementation on already deployed wallet!
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/test/upgrades/SmartAccount11.sol:SmartAccount11",
        freshAccount
      );

      /* userSCW = await ethers.getContractAt(
          "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
          freshAccount
        ); */

      const currentImpl = await userSCW.getImplementation();
      console.log("current implementation by querying: ", currentImpl);

      const currentEntryPoint = await userSCW.entryPoint();
      console.log("current entrypoint ", currentEntryPoint);
      expect(currentEntryPoint).to.be.equal(entryPoint.address);

      const currentHandler = await userSCW.getFallbackHandler();
      console.log("current handler ", currentHandler);
      expect(currentHandler).to.be.equal(handler.address);

      const codeAfter = await ethers.provider.getCode(freshAccount);
      console.log("wallet code after is: ", codeAfter);
    });

    it("4337 flow: batch : deploy + update handler from minimal to new one + send ether!", async () => {
      // Now the wallet with owner and index 0 and 1 and 2 and 3 is deployed!

      // anyway we will deploy a new one, so...
      const freshAccount =
        await walletFactory.getAddressForCounterFactualAccount(owner, 4);

      const codeBefore = await ethers.provider.getCode(freshAccount);
      console.log("wallet code before is: ", codeBefore);

      console.log("the wallet will be first deployed with entry point");

      await accounts[1].sendTransaction({
        from: bob,
        to: freshAccount,
        value: ethers.utils.parseEther("5"),
      });

      // Let's deploy a new handler!
      const DefaultHandler = await ethers.getContractFactory(
        "DefaultCallbackHandler"
      );
      const handler = await DefaultHandler.deploy();
      await handler.deployed();
      console.log("Default callback handler deployed at: ", handler.address);

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      // setFallbackHandler is also mixedAuth!
      const updateHandlerData = SmartAccount.interface.encodeFunctionData(
        "setFallbackHandler",
        [handler.address]
      );

      const charlieBalBefore = await ethers.provider.getBalance(charlie);

      const txnData = SmartAccount.interface.encodeFunctionData(
        "executeBatchCall_4by",
        [
          [freshAccount, charlie],
          [ethers.utils.parseEther("0"), ethers.utils.parseEther("1")],
          [updateHandlerData, "0x"],
        ]
      );

      console.log("transaction data ", txnData);

      const WalletFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );

      const encodedData = WalletFactory.interface.encodeFunctionData(
        "deployCounterFactualAccount",
        [owner, 4]
      );

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: freshAccount,
          callData: txnData,
          initCode: hexConcat([walletFactory.address, encodedData]),
          verificationGasLimit: 400000,
          callGasLimit: 1000000,
        },
        walletOwner, // since the owner signer is supposed to be walletOwner
        entryPoint,
        "nonce"
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        freshAccount,
        userOp1,
        offchainSigner,
        paymasterAddress,
        walletOwner,
        entryPoint
      );

      // This action should send userOp that upgrades implementation on already deployed wallet!
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/test/upgrades/SmartAccount11.sol:SmartAccount11",
        freshAccount
      );

      /* userSCW = await ethers.getContractAt(
            "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
            freshAccount
          ); */

      const currentImpl = await userSCW.getImplementation();
      console.log("current implementation by querying: ", currentImpl);

      const currentEntryPoint = await userSCW.entryPoint();
      console.log("current entrypoint ", currentEntryPoint);
      expect(currentEntryPoint).to.be.equal(entryPoint.address);

      const currentHandler = await userSCW.getFallbackHandler();
      console.log("current handler ", currentHandler);
      expect(currentHandler).to.be.equal(handler.address);

      const balActual = await ethers.provider.getBalance(charlie);
      expect(balActual).to.be.equal(
        charlieBalBefore.add(ethers.utils.parseEther("1"))
      );

      const codeAfter = await ethers.provider.getCode(freshAccount);
      console.log("wallet code after is: ", codeAfter);
    });

    it("4337 flow: batch : deploy + update implementation + update handler + dapp transactions", async () => {
      // Now the wallet with owner and index 0 and 1 and 2 and 3 and 4 is deployed!

      // anyway we will deploy a new one, so...
      const freshAccount =
        await walletFactory.getAddressForCounterFactualAccount(owner, 5);

      const codeBefore = await ethers.provider.getCode(freshAccount);
      console.log("wallet code before is: ", codeBefore);

      // preserved now..
      // latestEntryPoint = await deployEntryPoint();
      // console.log("latest entrypoint ", latestEntryPoint.address);

      const BaseImplementation11 = await ethers.getContractFactory(
        "SmartAccount11"
      );
      const baseImpl11 = await BaseImplementation11.deploy(entryPoint.address);
      await baseImpl11.deployed();
      console.log("base wallet new impl deployed at: ", baseImpl11.address);

      await accounts[1].sendTransaction({
        from: bob,
        to: freshAccount,
        value: ethers.utils.parseEther("5"),
      });

      // transfer erc20 token to the new wallet
      await token
        .connect(walletOwner)
        .transfer(freshAccount, ethers.utils.parseEther("100"));

      const erc20Interface = new ethers.utils.Interface([
        "function transfer(address _to, uint256 _value)",
      ]);

      // Encode an ERC-20 token transfer to recipient of the specified amount
      const transferData = erc20Interface.encodeFunctionData("transfer", [
        bob,
        ethers.utils.parseEther("10"),
      ]);

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const updateImplementationData =
        SmartAccount.interface.encodeFunctionData("updateImplementation", [
          baseImpl11.address,
        ]);

      // Let's deploy a new handler!
      const DefaultHandler = await ethers.getContractFactory(
        "DefaultCallbackHandler"
      );
      const handler = await DefaultHandler.deploy();
      await handler.deployed();
      console.log("Default callback handler deployed at: ", handler.address);

      // setFallbackHandler is also mixedAuth!
      const updateHandlerData = SmartAccount.interface.encodeFunctionData(
        "setFallbackHandler",
        [handler.address]
      );

      const bobBalanceBefore = await token.balanceOf(bob);

      const charlieBalBefore = await ethers.provider.getBalance(charlie);

      const txnData = SmartAccount.interface.encodeFunctionData(
        "executeBatchCall_4by",
        [
          [freshAccount, freshAccount, charlie, token.address],
          [
            ethers.utils.parseEther("0"),
            ethers.utils.parseEther("0"),
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("0"),
          ],
          [updateHandlerData, updateImplementationData, "0x", transferData],
        ]
      );

      console.log("transaction data ", txnData);

      const WalletFactory = await ethers.getContractFactory(
        "SmartAccountFactory"
      );

      const encodedData = WalletFactory.interface.encodeFunctionData(
        "deployCounterFactualAccount",
        [owner, 5]
      );

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: freshAccount,
          callData: txnData,
          initCode: hexConcat([walletFactory.address, encodedData]),
          verificationGasLimit: 400000,
          callGasLimit: 1000000,
        },
        walletOwner, // since the owner signer is supposed to be walletOwner
        entryPoint,
        "nonce"
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        freshAccount,
        userOp1,
        offchainSigner,
        paymasterAddress,
        walletOwner,
        entryPoint
      );

      // This action should send userOp that upgrades implementation on already deployed wallet!
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/test/upgrades/SmartAccount11.sol:SmartAccount11",
        freshAccount
      );

      /* userSCW = await ethers.getContractAt(
            "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
            freshAccount
          ); */

      const currentImpl = await userSCW.getImplementation();
      console.log("current implementation by querying: ", currentImpl);
      expect(currentImpl).to.be.equal(baseImpl11.address);

      const currentEntryPoint = await userSCW.entryPoint();
      console.log("current entrypoint ", currentEntryPoint);
      expect(currentEntryPoint).to.be.equal(entryPoint.address);

      const currentHandler = await userSCW.getFallbackHandler();
      console.log("current handler ", currentHandler);
      expect(currentHandler).to.be.equal(handler.address);

      const balActual = await ethers.provider.getBalance(charlie);
      expect(balActual).to.be.equal(
        charlieBalBefore.add(ethers.utils.parseEther("1"))
      );

      const bobBalanceAfter = await token.balanceOf(bob);
      expect(bobBalanceAfter).to.be.equal(
        bobBalanceBefore.add(ethers.utils.parseEther("10"))
      );

      const codeAfter = await ethers.provider.getCode(freshAccount);
      console.log("wallet code after is: ", codeAfter);
    });
  });
});
