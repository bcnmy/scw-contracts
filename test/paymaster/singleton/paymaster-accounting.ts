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
  DefaultCallbackHandler,
} from "../../../typechain";
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
} from "../../../src/utils/execution";
import {
  AddressZero,
  encodeTransfer,
  encodeTransferFrom,
  getBalance,
} from "../../smart-wallet/testutils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { fillAndSign, fillUserOp } from "../../utils/userOp";
import { arrayify, formatEther, hexConcat, parseEther } from "ethers/lib/utils";
import { BigNumber, Signer } from "ethers";
import { UserOperation } from "../../utils/userOpetation";

describe("Upgrade functionality Via Entrypoint", function () {
  let entryPoint: EntryPoint;
  let latestEntryPoint: EntryPoint;
  let walletOwner: Signer;
  let paymasterAddress: string;
  let paymasterOffchainSigner: Signer, deployer: Signer;
  let bundler: Signer;
  let paymaster: VerifyingSingletonPaymaster;
  let baseImpl: SmartWallet;
  let walletFactory: WalletFactory;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let ownerAddress: string;
  let deployerAddres: string;
  let bobAddress: string;
  let charlieAddress: string;
  let paymasterId: string;
  let userSCW: any;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();
    entryPoint = await deployEntryPoint();

    deployer = accounts[0];
    paymasterOffchainSigner = accounts[1];
    walletOwner = accounts[2];

    deployerAddres = await deployer.getAddress();
    ownerAddress = await walletOwner.getAddress();
    bobAddress = await accounts[3].getAddress();
    charlieAddress = await accounts[4].getAddress();
    paymasterId = await accounts[5].getAddress();

    bundler = accounts[6];
    const offchainSignerAddress = await paymasterOffchainSigner.getAddress();

    paymaster = await new VerifyingSingletonPaymaster__factory(deployer).deploy(
      await deployer.getAddress(),
      entryPoint.address,
      offchainSignerAddress
    );

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

    await token.mint(ownerAddress, ethers.utils.parseEther("1000000"));

    paymasterAddress = paymaster.address;

    await paymaster.connect(deployer).addStake(10, { value: parseEther("2") });
    console.log("Paymaster staked");

    await paymaster.depositFor(paymasterId, {
      value: parseEther("1"),
    });
  });

  describe("Check Paymaster Accounting is Correct", function () {
    it("Ensure bundler is paid enough fee", async () => {
      // Get User Op Object with initCode and paymaster data
      const valueToTransfer = "1";
      const callData = "0x";
      const destinationAddress = charlieAddress;

      const txnData = await getExecuteCallData(
        destinationAddress,
        valueToTransfer,
        callData
      );
      const { expectedWalletAddress, userOp } =
        await getUserOpWithInitCodeAndPaymasterData(
          entryPoint,
          walletFactory,
          paymaster,
          paymasterOffchainSigner,
          paymasterId,
          txnData,
          walletOwner
        );

      // Send some funds to smart contract wallet
      await sendEther(accounts[3], expectedWalletAddress, "5");

      // Check paymaster deposit and paymasterID deposit before executing userOp
      const paymasterDepositBefore = (
        await entryPoint.getDepositInfo(paymasterAddress)
      ).deposit;
      const paymasterIdDepositBefore = await paymaster.getBalance(paymasterId);

      // Execute UserOp transaction
      const tx = await entryPoint
        .connect(bundler)
        .handleOps([userOp], await bundler.getAddress());

      // Check paymaster deposit and paymasterID deposit after executing userOp
      const paymasterDepositAfter = (
        await entryPoint.getDepositInfo(paymasterAddress)
      ).deposit;
      const paymasterIdDepositAfter = await paymaster.getBalance(paymasterId);

      // Get Fee paid by paymaster and paymasterID
      const feePaidByPaymasterDeposit = paymasterDepositBefore.sub(
        paymasterDepositAfter
      );
      const feePaidByPaymasterID = paymasterIdDepositBefore.sub(
        paymasterIdDepositAfter
      );

      // Get actual transaction fee paid by bundler
      const transactionFee = await getTransactionFee(tx);

      await expect(feePaidByPaymasterID.toNumber()).to.be.greaterThan(
        feePaidByPaymasterDeposit.toNumber()
      );

      // Ensure that tx fee paid by bundler is less than the refund paid by paymaster
      await expect(transactionFee.toNumber()).to.be.lessThan(
        feePaidByPaymasterDeposit.toNumber()
      );
    });
  });
});

async function getUserOpWithInitCodeAndPaymasterData(
  entryPoint: EntryPoint,
  walletFactory: WalletFactory,
  paymaster: VerifyingSingletonPaymaster,
  paymasterOffchainSigner: Signer,
  paymasterId: string,
  callData: string,
  walletOwner: Signer
) {
  const _walletOwnerAddress = await walletOwner.getAddress();
  const paymasterAddress = await paymaster.address;
  const initCode = await getWalletInitCode(
    walletFactory,
    _walletOwnerAddress,
    0
  );

  const expectedWalletAddress = await getCounterFactualAddress(
    walletFactory,
    _walletOwnerAddress,
    0
  );

  // Start filling the userOp
  const userOp1 = await fillAndSign(
    {
      sender: expectedWalletAddress,
      callData: callData,
      verificationGasLimit: 320000,
      initCode: initCode,
    },
    walletOwner,
    entryPoint,
    21000
  );

  // Set paymaster data in UserOp
  const userOp = await getUserOpWithPaymasterData(
    paymaster,
    expectedWalletAddress,
    userOp1,
    paymasterOffchainSigner,
    paymasterId,
    paymasterAddress,
    walletOwner,
    entryPoint
  );
  return { expectedWalletAddress, userOp };
}

async function deployEntryPoint(
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
  paymasterId: string,
  paymasterAddress: string,
  walletOwner: Signer,
  entryPoint: EntryPoint
) {
  const nonceFromContract = await paymaster["getSenderPaymasterNonce(address)"](
    smartAccountAddress
  );

  const hash = await paymaster.getHash(
    userOp,
    nonceFromContract.toNumber(),
    paymasterId
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
          [paymasterId, sig]
        ),
      ]),
    },
    walletOwner,
    entryPoint
  );
  return userOpWithPaymasterData;
}

async function getWalletInitCode(
  walletFactory: WalletFactory,
  ownerAddress: string,
  index: number
) {
  const WalletFactory = await ethers.getContractFactory("SmartAccountFactory");

  const encodedData = WalletFactory.interface.encodeFunctionData(
    "deployCounterFactualAccount",
    [ownerAddress, index]
  );
  return hexConcat([walletFactory.address, encodedData]);
}

async function getTransactionFee(tx: any) {
  const receipt: any = await tx.wait();
  return receipt.gasUsed.mul(receipt.effectiveGasPrice);
}

async function getExecuteCallData(
  destination: string,
  ethValue: string,
  callData: string
) {
  const SmartAccount = await ethers.getContractFactory("SmartAccount");
  const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
    destination,
    ethers.utils.parseEther(ethValue),
    callData,
  ]);
  return txnData;
}

async function sendEther(from: any, to: string, amount: string) {
  await from.sendTransaction({
    from: await from.getAddress(),
    to: to,
    value: ethers.utils.parseEther(amount),
  });
}

async function getCounterFactualAddress(
  walletFactory: WalletFactory,
  ownerAddress: string,
  index: number
) {
  return await walletFactory.getAddressForCounterfactualAccount(
    ownerAddress,
    index
  );
}
