/* eslint-disable node/no-missing-import */
/* eslint-disable camelcase */
import { Create2Factory } from "../../../src/Create2Factory";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  SmartAccount,
  SmartAccount__factory,
  DefaultCallbackHandler,
  DefaultCallbackHandler__factory,
  EntryPoint,
  VerifyingSingletonPaymaster,
  VerifyingSingletonPaymaster__factory,
  SmartAccountFactory,
  SmartAccountFactory__factory,
  EntryPoint__factory,
} from "../../../typechain";
import { AddressZero } from "../../smart-wallet/testutils";
import { fillAndSign, fillUserOp } from "../../utils/userOp";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";
import { BigNumber, BigNumberish, Contract, Signer } from "ethers";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const create2factory = new Create2Factory(provider);
  const epf = new EntryPoint__factory(provider.getSigner());
  const addr = await create2factory.deploy(epf.bytecode, 0);
  return EntryPoint__factory.connect(addr, provider.getSigner());
}

describe("EntryPoint with VerifyingPaymaster", function () {
  let entryPoint: EntryPoint;
  let entryPointStatic: EntryPoint;
  let depositorSigner: Signer;
  let walletOwner: Signer;
  let proxyPaymaster: Contract;
  let walletAddress: string, paymasterAddress: string;
  let ethersSigner;

  let offchainSigner: Signer, deployer: Signer;

  let verifyingSingletonPaymaster: VerifyingSingletonPaymaster;
  let verifyPaymasterFactory: VerifyingPaymasterFactory;
  let smartWalletImp: SmartWallet;
  let walletFactory: WalletFactory;
  let callBackHandler: DefaultCallbackHandler;
  const abi = ethers.utils.defaultAbiCoder;

  beforeEach(async function () {
    ethersSigner = await ethers.getSigners();
    entryPoint = await deployEntryPoint();
    entryPointStatic = entryPoint.connect(AddressZero);

    deployer = ethersSigner[0];
    offchainSigner = ethersSigner[1];
    depositorSigner = ethersSigner[2];
    walletOwner = deployer; // ethersSigner[3];

    const offchainSignerAddress = await offchainSigner.getAddress();
    const walletOwnerAddress = await walletOwner.getAddress();

    verifyingSingletonPaymaster =
      await new VerifyingSingletonPaymaster__factory(deployer).deploy(
        entryPoint.address,
        offchainSignerAddress
      );

    smartWalletImp = await new SmartAccount__factory(deployer).deploy();

    walletFactory = await new SmartAccountFactory__factory(deployer).deploy(
      smartWalletImp.address
    );

    callBackHandler = await new DefaultCallbackHandler__factory(
      deployer
    ).deploy();

    await walletFactory.deployCounterFactualWallet(
      walletOwnerAddress,
      entryPoint.address,
      callBackHandler.address,
      0
    );
    const expected = await walletFactory.getAddressForCounterfactualWallet(
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

    const hash = await verifyingSingletonPaymaster.getHash(userOp1);
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

  describe("#validatePaymasterUserOp", () => {
    it("Should Fail when there is no deposit for paymaster id", async () => {
      const paymasterId = await depositorSigner.getAddress();
      const userOp = await getUserOpWithPaymasterInfo(paymasterId);
      await expect(
        verifyingSingletonPaymaster.validatePaymasterUserOp(
          userOp,
          ethers.utils.hexZeroPad("0x1234", 32),
          1029
        )
      ).to.be.revertedWith("Insufficient balance for paymaster id");
    });

    /* it("Should Fail when deposit for paymaster id is not enough", async () => {
      // Do the deposit on behalf of paymaster id
      const paymasterId = await depositorSigner.getAddress();
      const depositAmount = 1028;
      const requiredFundsInPaymaster = 1029;
      await verifyingSingletonPaymaster.deposit(paymasterId, {
        value: depositAmount,
      });

      const userOp = await getUserOpWithPaymasterInfo(paymasterId);
      await expect(
        verifyingSingletonPaymaster.validatePaymasterUserOp(
          userOp,
          ethers.utils.hexZeroPad("0x1234", 32),
          requiredFundsInPaymaster
        )
      ).to.be.revertedWith("Insufficient balance for paymaster id");
    });

    it("Should validate user op successfully", async () => {
      // Do the deposit on behalf of paymaster id
      const paymasterId = await depositorSigner.getAddress();
      const depositAmount = 1030;
      const requiredFundsInPaymaster = 1029;
      await verifyingSingletonPaymaster.deposit(paymasterId, {
        value: depositAmount,
      });

      const userOp = await getUserOpWithPaymasterInfo(paymasterId);
      const paymasterContext =
        await verifyingSingletonPaymaster.validatePaymasterUserOp(
          userOp,
          ethers.utils.hexZeroPad("0x1234", 32),
          requiredFundsInPaymaster
        );
      const paymasterIdFromContext = abi.decode(["address"], paymasterContext);
      await expect(paymasterIdFromContext[0]).to.be.eq(paymasterId);
    }); */

    /* it("Should validate simulation from entry point", async () => {
      // Do the deposit on behalf of paymaster id
      const paymasterId = await depositorSigner.getAddress();
      const depositAmount = 1030;
      const requiredFundsInPaymaster = 1029;
      await verifyingSingletonPaymaster.deposit(paymasterId, {
        value: depositAmount,
      });

      const userOp = await getUserOpWithPaymasterInfo(paymasterId);
      const paymasterContext =
        await verifyingSingletonPaymaster.validatePaymasterUserOp(
          userOp,
          ethers.utils.hexZeroPad("0x1234", 32),
          requiredFundsInPaymaster
        );
      const paymasterIdFromContext = abi.decode(["address"], paymasterContext);
      await expect(paymasterIdFromContext[0]).to.be.eq(paymasterId);
    }); */

    //   it("should reject on no signature", async () => {
    //     const userOp = await fillAndSign(
    //       {
    //         sender: walletAddress,
    //         paymasterAndData: hexConcat([paymasterAddress, "0x1234"]),
    //       },
    //       walletOwner,
    //       entryPoint
    //     );
    //     await expect(
    //       entryPointStatic.callStatic.simulateValidation(userOp, false)
    //     ).to.be.revertedWith("invalid signature length in paymasterAndData");
    //   });
    //   it("should reject on invalid signature", async () => {
    //     const userOp = await fillAndSign(
    //       {
    //         sender: walletAddress,
    //         paymasterAndData: hexConcat([
    //           paymasterAddress,
    //           "0x" + "1c".repeat(65),
    //         ]),
    //       },
    //       walletOwner,
    //       entryPoint
    //     );
    //     await expect(
    //       entryPointStatic.callStatic.simulateValidation(userOp, false)
    //     ).to.be.revertedWith("ECDSA: invalid signature");
    //   });
    //   it("succeed with valid signature", async () => {
    //     const userOp1 = await fillAndSign(
    //       {
    //         sender: walletAddress,
    //       },
    //       walletOwner,
    //       entryPoint
    //     );
    //     const hash = await proxyPaymaster.getHash(userOp1);
    //     const sig = await offchainSigner.signMessage(arrayify(hash));
    //     const userOp = await fillAndSign(
    //       {
    //         ...userOp1,
    //         paymasterAndData: hexConcat([paymasterAddress, sig]),
    //       },
    //       walletOwner,
    //       entryPoint
    //     );
    //     await entryPointStatic.callStatic.simulateValidation(userOp, false);
    //   });
  });
});
