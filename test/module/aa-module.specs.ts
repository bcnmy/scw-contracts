import { expect } from "chai";
import { ethers } from "hardhat";
import {
  SmartAccount,
  SmartAccountFactory,
  EntryPoint,
  SocialRecoveryModule,
  WhitelistModule,
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
  executeContractCallWithSigners,
} from "../../src/utils/execution";
import { encodeTransfer } from "../smart-wallet/testUtils";
import { fillAndSign, fillUserOp } from "../utils/userOp";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";
import { Signer } from "ethers";
import { UserOperation } from "../utils/userOpetation";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

export const AddressZero = "0x0000000000000000000000000000000000000000";
export const AddressOne = "0x0000000000000000000000000000000000000001";

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
    'nonce'
  );
  return userOpWithPaymasterData;
}

describe("Module transactions via AA flow", function () {
  let entryPoint: EntryPoint;
  let latestEntryPoint: EntryPoint;
  let walletOwner: Signer;
  let paymasterAddress: string;
  let offchainSigner: Signer, deployer: Signer;
  let offchainSigner2: Signer;
  let verifyingSingletonPaymaster: VerifyingSingletonPaymaster;
  let baseImpl: SmartAccount;
  let whitelistModule: WhitelistModule;
  let socialRecoveryModule: SocialRecoveryModule;
  let walletFactory: SmartAccountFactory;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let owner: string;
  let bob: string;
  let charlie: string;
  let newAuthority: string;
  let userSCW: any;
  let accounts: any;
  let tx: any;

  before(async () => {
    accounts = await ethers.getSigners();
    entryPoint = await deployEntryPoint();

    deployer = accounts[0];
    offchainSigner = accounts[1];
    offchainSigner2 = accounts[3];
    walletOwner = deployer;

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();
    newAuthority = await accounts[3].getAddress();

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

    const WhitelistModule = await ethers.getContractFactory("WhitelistModule");
    whitelistModule = await WhitelistModule.deploy(bob);
    console.log("Test module deployed at ", whitelistModule.address);

    // social recovery module deploy - socialRecoveryModule
    const SocialRecoveryModule = await ethers.getContractFactory(
      "SocialRecoveryModule"
    );
    socialRecoveryModule = await SocialRecoveryModule.connect(
      accounts[0]
    ).deploy();
    console.log(
      "SocialRecoveryModule deployed at ",
      socialRecoveryModule.address
    );

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
        'nonce'
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
        'nonce'
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

      const uerOpHash = await entryPoint?.getUserOpHash(userOp);

      const VerifyingPaymaster = await ethers.getContractFactory(
        "VerifyingSingletonPaymaster"
      );

      const validatePaymasterUserOpData =
        VerifyingPaymaster.interface.encodeFunctionData(
          "validatePaymasterUserOp",
          [userOp, uerOpHash, 10]
        );

      const gasEstimatedValidateUserOp = await ethers.provider.estimateGas({
        from: entryPoint?.address,
        to: paymasterAddress,
        data: validatePaymasterUserOpData, // validatePaymasterUserOp calldata
      });

      console.log(
        "Gaslimit for validate paymaster userOp is: ",
        gasEstimatedValidateUserOp
      );

      // todo
      // try and get for postOp as well
      // get results for different parameters

      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());
      await expect(
        entryPoint.handleOps([userOp], await offchainSigner.getAddress())
      ).to.be.reverted;

      const balCharlieActual = await ethers.provider.getBalance(charlie);
      expect(balCharlieActual).to.be.equal(
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
        'nonce'
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

  describe("Module transactions from Smart Account", function () {
    it("can enable modules and accept transactions from it", async function () {
      // Now here also the wallet with owner and index 0 should have been deployed
      // also it has the owner accounts[5]

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);
      // although owner is different we get the same address by previous owner

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      const code = await ethers.provider.getCode(expectedSmartAccountAddress);
      console.log("wallet code is: ", code);

      await token
        .connect(accounts[0])
        .transfer(expectedSmartAccountAddress, ethers.utils.parseEther("100"));

      // whitelisting target contract
      await whitelistModule
        .connect(accounts[1])
        .whitelistDestination(token.address);

      // Owner itself can not directly add modules
      await expect(
        userSCW.connect(accounts[5]).enableModule(whitelistModule.address)
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
          [accounts[5]]
        )
      ).to.emit(userSCW, "ExecutionSuccess");

      expect(await token.balanceOf(charlie)).to.equal(
        ethers.utils.parseEther("0")
      );

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

    it("disable module", async function () {
      // Now here also the wallet with owner and index 0 should have been deployed
      // also it has the owner accounts[5]

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);
      // although owner is different we get the same address by previous owner

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      const code = await ethers.provider.getCode(expectedSmartAccountAddress);
      console.log("wallet code is: ", code);

      await token
        .connect(accounts[0])
        .transfer(expectedSmartAccountAddress, ethers.utils.parseEther("100"));

      // Owner itself can not directly add modules
      await expect(
        userSCW.connect(accounts[5]).enableModule(whitelistModule.address)
      ).to.be.reverted;

      // Can't enable module which is already enabled!
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "enableModule",
          [whitelistModule.address],
          [accounts[5]]
        )
      ).to.be.reverted;

      const isEnabled = await userSCW.isModuleEnabled(whitelistModule.address);
      expect(isEnabled).to.be.equal(true);

      /* expect(
        await userSCW.getModulesPaginated(AddressOne, 10)
      ).to.be.deep.equal([[whitelistModule.address], AddressOne]); */

      // Disabling module
      // it("can not set sentinel"
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "disableModule",
          [AddressOne, AddressOne],
          [accounts[5]]
        )
      ).to.be.reverted;

      // Disabling module
      // it("can not set 0 Address"
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "disableModule",
          [AddressOne, AddressZero],
          [accounts[5]]
        )
      ).to.be.reverted;

      // Disabling module
      //  it("Invalid prevModule, module pair provided - Invalid sentinel"
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "disableModule",
          [AddressZero, whitelistModule.address],
          [accounts[5]]
        )
      ).to.be.reverted;

      // Disabling module
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "disableModule",
          [AddressOne, whitelistModule.address],
          [accounts[5]]
        )
      ).to.emit(userSCW, "ExecutionSuccess");

      // invoking module!
      // Should not succeed
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

      // Balance is still 10!
      expect(await token.balanceOf(charlie)).to.equal(
        ethers.utils.parseEther("10")
      );
    });
  });

  describe("enable basic module and send transactions using AA flow", function () {
    it("enable whitelist module using EntryPoint (and Paymaster)", async function () {
      // Now here also the wallet with owner and index 0 should have been deployed
      // also it has the owner accounts[5]

      // will deploy a new wallet with index 1

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 1);

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      await walletFactory.deployCounterFactualAccount(owner, 1);

      const prevNonce = await userSCW.nonce();
      console.log("previous nonce is: ", prevNonce.toNumber());

      await token
        .connect(accounts[0])
        .transfer(expectedSmartAccountAddress, ethers.utils.parseEther("100"));

      // module is already deployed and destination whitelisted

      // enabling module...

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const txnDataEnableModule = SmartAccount.interface.encodeFunctionData(
        "enableModule",
        [whitelistModule.address]
      );

      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          expectedSmartAccountAddress,
          ethers.utils.parseEther("0"),
          txnDataEnableModule,
        ]
      );

      console.log("data for executeCall");

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnDataAA1,
          verificationGasLimit: 5000000,
          // no callGasLImit override as wallet is deployed
        },
        walletOwner,
        entryPoint,
        'nonce'
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
        'nonce'
      );
      console.log(userOp);
      // const userOpHash = await entryPoint.getUserOpHash(userOp);
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress(), {
        gasLimit: 10000000,
      });
      /* await expect(
        entryPoint.handleOps([userOp], await offchainSigner.getAddress())
      ).to.be.reverted; */

      const currentNonce = await userSCW.nonce();
      console.log("latest nonce is: ", currentNonce.toNumber());

      const isEnabled = await userSCW.isModuleEnabled(whitelistModule.address);
      expect(isEnabled).to.be.equal(true);

      /* expect(
        await userSCW.getModulesPaginated(AddressOne, 10)
      ).to.be.deep.equal([[whitelistModule.address], AddressOne]); */
    });

    it("send transaction from enabled module using EntryPoint (and Paymaster)", async function () {
      // Now here also the wallet with owner and index 1 should have been deployed

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 1);

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      const prevNonce = await userSCW.nonce();
      console.log("previous nonce is: ", prevNonce.toNumber());

      await token
        .connect(accounts[0])
        .transfer(expectedSmartAccountAddress, ethers.utils.parseEther("100"));

      // module is already deployed, enabled and destination whitelisted

      const isEnabled = await userSCW.isModuleEnabled(whitelistModule.address);
      expect(isEnabled).to.be.equal(true);

      /* expect(
        await userSCW.getModulesPaginated(AddressOne, 10)
      ).to.be.deep.equal([[whitelistModule.address], AddressOne]); */

      // invoking transaction via enabled module

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const WhitelistModule = await ethers.getContractFactory(
        "WhitelistModule"
      );

      const txnDataModule = WhitelistModule.interface.encodeFunctionData(
        "authCall",
        [
          expectedSmartAccountAddress,
          token.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
        ]
      );

      console.log("data for authCall");

      const txnDataAA2 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [whitelistModule.address, ethers.utils.parseEther("0"), txnDataModule]
      );

      console.log("data for executeCall");

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnDataAA2,
          // verificationGasLimit: 5000000,
          // no callGasLImit override as wallet is deployed
        },
        accounts[7], // not an owner // as good as overriding later with fake sig!
        entryPoint,
        'nonce'
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
        'nonce'
      );
      console.log(userOp);
      // TODO: Replace signature with mock signature..
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress(), {
        gasLimit: 10000000,
      });
      /* await expect(
          entryPoint.handleOps([userOp], await offchainSigner.getAddress())
        ).to.be.reverted; */

      const currentNonce = await userSCW.nonce();
      console.log("latest nonce is: ", currentNonce.toNumber());

      // now we increase nonce for module txns as well
      expect(currentNonce).to.be.equal(prevNonce.add(1));

      // Balance should be 20 now
      expect(await token.balanceOf(charlie)).to.equal(
        ethers.utils.parseEther("20")
      );
    });
  });

  describe("enable social recovery module and swap owner using AA flow", function () {
    it("enable social recovery module using EntryPoint (and Paymaster)", async function () {
      // Now here also the wallet with owner and index 0 and index 1 should have been deployed

      // will deploy a new wallet with index 2

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 2);

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      await walletFactory.deployCounterFactualAccount(owner, 2);

      const prevNonce = await userSCW.nonce();
      console.log("previous nonce is: ", prevNonce.toNumber());

      await token
        .connect(accounts[0])
        .transfer(expectedSmartAccountAddress, ethers.utils.parseEther("100"));

      // module is already deployed and destination whitelisted

      // enabling social recovery module... Step 1

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const txnDataEnableModule = SmartAccount.interface.encodeFunctionData(
        "enableModule",
        [socialRecoveryModule.address]
      );

      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          expectedSmartAccountAddress,
          ethers.utils.parseEther("0"),
          txnDataEnableModule,
        ]
      );

      console.log("data for executeCall");

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnDataAA1,
          verificationGasLimit: 5000000,
          // no callGasLImit override as wallet is deployed
        },
        walletOwner,
        entryPoint,
        'nonce'
      );

      const hash = await verifyingSingletonPaymaster.getHash(
        userOp1,
        await offchainSigner.getAddress()
      );
      const sig = await offchainSigner.signMessage(arrayify(hash));
      const userOpAA1 = await fillAndSign(
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
        'nonce'
      );
      console.log(userOpAA1);
      await entryPoint.handleOps(
        [userOpAA1],
        await offchainSigner.getAddress(),
        {
          gasLimit: 10000000,
        }
      );
      /* await expect(
        entryPoint.handleOps([userOp], await offchainSigner.getAddress())
      ).to.be.reverted; */

      const currentNonce = await userSCW.nonce();
      console.log("latest nonce is: ", currentNonce.toNumber());

      const isEnabled = await userSCW.isModuleEnabled(
        socialRecoveryModule.address
      );
      expect(isEnabled).to.be.equal(true);

      /* expect(
        await userSCW.getModulesPaginated(AddressOne, 10)
      ).to.be.deep.equal([[socialRecoveryModule.address], AddressOne]); */

      // Enable social recovery module : Step 2 (setup)

      // setup social recovery module, set bob,charlie as friends and set threshold as 2
      // must be called via the users SCW
      const setupModuleData = socialRecoveryModule.interface.encodeFunctionData(
        "setup",
        [[bob, charlie], 2]
      );

      const txnDataAA2 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          socialRecoveryModule.address,
          ethers.utils.parseEther("0"),
          setupModuleData,
        ]
      );

      console.log("data for executeCall");

      const userOp2 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnDataAA2,
          verificationGasLimit: 5000000,
          // no callGasLImit override as wallet is deployed
        },
        walletOwner,
        entryPoint,
        'nonce'
      );

      const hash2 = await verifyingSingletonPaymaster.getHash(
        userOp2,
        await offchainSigner.getAddress()
      );
      const sig2 = await offchainSigner.signMessage(arrayify(hash2));
      const userOpAA2 = await fillAndSign(
        {
          ...userOp2,
          paymasterAndData: hexConcat([
            paymasterAddress,
            ethers.utils.defaultAbiCoder.encode(
              ["address", "bytes"],
              [await offchainSigner.getAddress(), sig2]
            ),
          ]),
        },
        walletOwner,
        entryPoint,
        'nonce'
      );
      console.log(userOpAA2);
      await entryPoint.handleOps(
        [userOpAA2],
        await offchainSigner.getAddress(),
        {
          gasLimit: 10000000,
        }
      );

      // checking if they have been added as friends for our account
      const isBobAFriend = await socialRecoveryModule.isFriend(
        expectedSmartAccountAddress,
        bob
      );
      const isCharlieAFriend = await socialRecoveryModule.isFriend(
        expectedSmartAccountAddress,
        charlie
      );
      expect(isBobAFriend).to.equal(true);
      expect(isCharlieAFriend).to.equal(true);
    });

    it("send transaction from enabled social recovery module using EntryPoint (and Paymaster)", async function () {
      // Now here also the wallet with owner and index 2 should have been deployed

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 2);

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      const prevNonce = await userSCW.nonce();
      console.log("previous nonce is: ", prevNonce.toNumber());

      await token
        .connect(accounts[0])
        .transfer(expectedSmartAccountAddress, ethers.utils.parseEther("100"));

      // module is already deployed, enabled and destination whitelisted

      const isEnabled = await userSCW.isModuleEnabled(
        socialRecoveryModule.address
      );
      expect(isEnabled).to.be.equal(true);

      /* expect(
        await userSCW.getModulesPaginated(AddressOne, 10)
      ).to.be.deep.equal([[socialRecoveryModule.address], AddressOne]); */

      // invoking transaction via enabled module

      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const SocialRecoveryModule = await ethers.getContractFactory(
        "SocialRecoveryModule"
      );

      const newOwner = accounts[5];

      // bob confirms transaction for setOwner()
      tx = await socialRecoveryModule
        .connect(accounts[1])
        .confirmTransaction(userSCW.address, newOwner.address);
      // charlie confirms transaction for setOwner()
      tx = await socialRecoveryModule
        .connect(accounts[2])
        .confirmTransaction(userSCW.address, newOwner.address);

      // have to make entrypoint do confirmTransaction somehow

      const txnDataModule = SocialRecoveryModule.interface.encodeFunctionData(
        "recoverAccess",
        [userSCW.address, newOwner.address]
      );

      const txnDataAA2 = SmartAccount.interface.encodeFunctionData(
        "executeCall",
        [
          socialRecoveryModule.address,
          ethers.utils.parseEther("0"),
          txnDataModule,
        ]
      );

      console.log("data for executeCall");

      // let's also update offchainSigner
      await verifyingSingletonPaymaster
        .connect(accounts[0])
        .setSigner(await offchainSigner2.getAddress());

      const currentSigner = await verifyingSingletonPaymaster.verifyingSigner();

      expect(currentSigner).to.be.equal(newAuthority);

      // const smartAccountCallData = "0x";
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnDataAA2,
          // verificationGasLimit: 5000000,
          // no callGasLImit override as wallet is deployed
        },
        accounts[8], // not an owner
        entryPoint,
        'nonce'
      );

      const hash = await verifyingSingletonPaymaster.getHash(
        userOp1,
        await offchainSigner.getAddress() // paymaster id is still same as previous offchain signer
      );
      const sig = await offchainSigner2.signMessage(arrayify(hash));
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
        'nonce'
      );
      console.log(userOp);
      // TODO: Replace signature with mock signature..
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress(), {
        gasLimit: 10000000,
      });

      const currentNonce = await userSCW.nonce();
      console.log("latest nonce is: ", currentNonce.toNumber());

      // now we increase nonce for module txns as well
      expect(currentNonce).to.be.equal(prevNonce.add(1));

      // Balance should remain 20
      expect(await token.balanceOf(charlie)).to.equal(
        ethers.utils.parseEther("20")
      );

      console.log(
        "newOner should be",
        newOwner.address,
        "and is",
        await userSCW.owner()
      );
      // check if owner is updated
      expect(await userSCW.owner()).to.equal(newOwner.address);
    });
  });
});
