/* eslint-disable node/no-missing-import */
/* eslint-disable camelcase */
import { Create2Factory } from "../../../src/Create2Factory";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  SmartWallet,
  SmartWallet__factory,
  DefaultCallbackHandler,
  DefaultCallbackHandler__factory,
  EntryPoint,
  VerifyingSingletonPaymaster,
  VerifyingSingletonPaymaster__factory,
  VerifyingPaymasterFactory,
  VerifyingPaymasterFactory__factory,
  WalletFactory,
  WalletFactory__factory,
  EntryPoint__factory,
} from "../../../typechain";
import { AddressZero } from "../../smart-wallet/testutils";
import { fillAndSign, fillUserOp } from "../../utils/userOp";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";
import { BigNumber, BigNumberish, Contract, Signer } from "ethers";

export async function deployEntryPoint(
  paymasterStake: BigNumberish,
  unstakeDelaySecs: BigNumberish,
  provider = ethers.provider
): Promise<EntryPoint> {
  const create2factory = new Create2Factory(provider);
  const epf = new EntryPoint__factory(provider.getSigner());
  const ctrParams = ethers.utils.defaultAbiCoder.encode(
    ["uint256", "uint256"],
    [paymasterStake, unstakeDelaySecs]
  );

  const addr = await create2factory.deploy(
    hexConcat([epf.bytecode, ctrParams]),
    0
  );
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

  before(async function () {
    ethersSigner = await ethers.getSigners();
    entryPoint = await deployEntryPoint(1, 1);
    entryPointStatic = entryPoint.connect(AddressZero);

    deployer = ethersSigner[0];
    offchainSigner = ethersSigner[1];
    depositorSigner = ethersSigner[2];
    walletOwner = ethersSigner[3];

    const offchainSignerAddress = await offchainSigner.getAddress();
    const walletOwnerAddress = await walletOwner.getAddress();

    verifyingSingletonPaymaster =
      await new VerifyingSingletonPaymaster__factory(deployer).deploy(
        entryPoint.address,
        walletOwnerAddress,
        offchainSignerAddress
      );

    smartWalletImp = await new SmartWallet__factory(deployer).deploy();

    walletFactory = await new WalletFactory__factory(deployer).deploy(
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

    await verifyingSingletonPaymaster
      .connect(walletOwner)
      .addStake(0, { value: parseEther("2") });
    await entryPoint.depositTo(paymasterAddress, { value: parseEther("1") });
    const resultSet = await entryPoint.getDepositInfo(paymasterAddress);
    console.log("deposited state ", resultSet);
  });

  describe("#validatePaymasterUserOp", () => {
    it("Should validate user op successfully", async () => {
      const paymasterId = await depositorSigner.getAddress();
      console.log("Paymaster ID ", paymasterId);

      const userOp1 = await fillAndSign(
        {
          sender: walletAddress,
        },
        walletOwner,
        entryPoint
      );
      console.log("user op is ", userOp1);
      const hash = await verifyingSingletonPaymaster.getHash(userOp1);
      const sig = await offchainSigner.signMessage(arrayify(hash));
      console.log("signature is ", sig);
      const userOp = await fillAndSign(
        {
          ...userOp1,
          paymasterAndData: hexConcat([paymasterAddress, paymasterId, sig]),
        },
        walletOwner,
        entryPoint
      );
      await verifyingSingletonPaymaster.validatePaymasterUserOp(
        userOp,
        ethers.utils.hexZeroPad("0x1234", 32),
        1029
      );

      // take signature of paymaster signer here and prepare the final user OP

      console.log(userOp);
    });
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
