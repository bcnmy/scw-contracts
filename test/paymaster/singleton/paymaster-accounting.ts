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

describe("Upgrade functionality Via Entrypoint", function () {
  let entryPoint: EntryPoint;
  let latestEntryPoint: EntryPoint;
  let walletOwner: Signer;
  let paymasterAddress: string;
  let offchainSigner: Signer, deployer: Signer;
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
    offchainSigner = accounts[1];
    walletOwner = accounts[2];

    deployerAddres = await deployer.getAddress();
    ownerAddress = await walletOwner.getAddress();
    bobAddress = await accounts[3].getAddress();
    charlieAddress = await accounts[4].getAddress();
    paymasterId = await accounts[5].getAddress();

    const offchainSignerAddress = await offchainSigner.getAddress();

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

  describe("Basic Userops using Entrypoint", function () {
    it("succeed with valid signature", async () => {
      // Deploying wallet first
      await walletFactory.deployCounterFactualWallet(ownerAddress, 0);
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterfactualWallet(ownerAddress, 0);

      // Send some funds to smart contract wallet
      await accounts[3].sendTransaction({
        from: bobAddress,
        to: expectedSmartAccountAddress,
        value: ethers.utils.parseEther("5"),
      });

      // Prepare CallData for userOp
      const SmartAccount = await ethers.getContractFactory("SmartAccount");
      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        charlieAddress,
        ethers.utils.parseEther("1"),
        "0x",
      ]);

      // Start filling the userOp
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnData,
          verificationGasLimit: 200000,
        },
        walletOwner,
        entryPoint,
        22288 + 3422
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        paymaster,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        paymasterId,
        paymasterAddress,
        walletOwner,
        entryPoint
      );
      userOp.preVerificationGas = Number(userOp.preVerificationGas);
      const paymasterDepositBefore = await entryPoint.getDepositInfo(
        paymasterAddress
      );
      //   console.log(
      //     "Paymaster deposit before tx: ",
      //     formatEther(paymasterDepositBefore.deposit)
      //   );

      const paymasterIdDepositBefore = await paymaster.getBalance(paymasterId);
      //   console.log(
      //     "PaymasterId Deposit Before: ",
      //     formatEther(paymasterIdDepositBefore)
      //   );

      const relayerBalanceBefore = await ethers.provider.getBalance(
        deployerAddres
      );
      console.log(
        "Balance of relayer before tx: ",
        formatEther(relayerBalanceBefore)
      );
      console.log(userOp);
      // console.log(
      //   "MaxFeePerGas",
      //   userOp.maxFeePerGas,
      //   " MaxPriorityFeePerGas: ",
      //   userOp.maxPriorityFeePerGas
      // );
      // Execute UserOp transaction
      const tx = await entryPoint
        .connect(deployer)
        .handleOps([userOp], deployerAddres, {
          maxPriorityFeePerGas: "1000000000",
          maxFeePerGas: "1222585661",
        });

      // Get Paymster deposit information on entry point
      const paymasterDepositAfter = await entryPoint.getDepositInfo(
        paymasterAddress
      );
      // console.log(
      //   "Paymaster deposit after tx: ",
      //   formatEther(paymasterDepositAfter.deposit)
      // );

      const paymasterIdDepositAfter = await paymaster.getBalance(paymasterId);
      // console.log(
      //   "PaymasterId Deposit After: ",
      //   formatEther(paymasterIdDepositAfter)
      // );

      // Get Receipt and Transaction Fee
      const receipt: any = await tx.wait();
      // console.log("Gas Used: ", receipt.gasUsed);
      console.log(
        "************ Effective Gas Price: ",
        receipt.effectiveGasPrice
      );
      // console.log("Block Number: ", tx.blockNumber);
      const feeData = ethers.provider.getFeeData();
      // console.log("Base Fee: ", (await feeData).lastBaseFeePerGas);

      const transactionFee = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const relayerBalanceAfter = await ethers.provider.getBalance(
        deployerAddres
      );
      console.log(
        "Balance of relayer after tx: ",
        formatEther(relayerBalanceAfter)
      );
      console.log(
        "Difference in relayer balance (After - Before) (Should be +ve): ",
        formatEther(relayerBalanceAfter.sub(relayerBalanceBefore))
      );
      console.log("Transaction Fee: ", formatEther(transactionFee));

      console.log(
        "Paymaster deposit deducted from entry Point: ",
        formatEther(
          paymasterDepositBefore.deposit.sub(paymasterDepositAfter.deposit)
        )
      );
      console.log(
        "PaymasterID deposit deducted from Paymaster: ",
        formatEther(paymasterIdDepositBefore.sub(paymasterIdDepositAfter))
      );
      await expect(
        entryPoint.handleOps([userOp], await offchainSigner.getAddress())
      ).to.be.reverted;
    });
  });
});
