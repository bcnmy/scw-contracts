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
  MaliciousAccount2,
  MaliciousAccount2__factory,
  EntryPoint__factory,
} from "../../../typechain";
import { AddressZero } from "../../smart-wallet/testUtils";
import { simulationResultCatch } from "../../aa-core/testutils";
import { fillAndSign, fillUserOp } from "../../utils/userOp";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";
import { BigNumber, BigNumberish, Contract, Signer } from "ethers";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

describe("EntryPoint with VerifyingPaymaster Singleton", function () {
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
  let maliciousWallet: MaliciousAccount2;
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
        await deployer.getAddress(),
        entryPoint.address,
        offchainSignerAddress
      );

    callBackHandler = await new DefaultCallbackHandler__factory(
      deployer
    ).deploy();

    smartWalletImp = await new SmartAccount__factory(deployer).deploy(
      entryPoint.address
    );

    maliciousWallet = await new MaliciousAccount2__factory(deployer).deploy(
      entryPoint.address
    );

    walletFactory = await new SmartAccountFactory__factory(deployer).deploy(
      smartWalletImp.address
    );

    await walletFactory.deployCounterFactualAccount(walletOwnerAddress, 0);
    const expected = await walletFactory.getAddressForCounterFactualAccount(
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
      entryPoint,
      "nonce"
    );

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
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
      entryPoint,
      "nonce"
    );
  }

  describe("#validatePaymasterUserOp", () => {
    it("Should Fail when there is no deposit for paymaster id", async () => {
      const paymasterId = await depositorSigner.getAddress();
      console.log("paymaster Id ", paymasterId);
      const userOp = await getUserOpWithPaymasterInfo(paymasterId);
      console.log("entrypoint ", entryPoint.address);
      await expect(
        entryPoint.callStatic.simulateValidation(userOp)
        // ).to.be.revertedWith("FailedOp");
      ).to.be.reverted;
    });

    it("succeed with valid signature", async () => {
      const signer = await verifyingSingletonPaymaster.verifyingSigner();
      const offchainSignerAddress = await offchainSigner.getAddress();
      expect(signer).to.be.equal(offchainSignerAddress);

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
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());
      await expect(
        entryPoint.handleOps([userOp], await offchainSigner.getAddress())
      ).to.be.reverted;
    });

    /* it("signature replay", async () => {
      console.log("Paymaster Signed for good sender😇");
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
        entryPoint,
        "nonce"
      );

      const hash = await verifyingSingletonPaymaster.getHash(
        userOp1,
        await offchainSigner.getAddress()
      );
      const sig = await offchainSigner.signMessage(arrayify(hash));
      console.log("offchainSigner : " + (await offchainSigner.getAddress()));
      console.log("good sender becomes malicious😈");

      const upgrader = await (
        await ethers.getContractFactory("Upgrader")
      ).deploy();
      const w = SmartAccount__factory.connect(walletAddress, walletOwner);

      await w.executeCall(
        w.address,
        0,
        w.interface.encodeFunctionData("enableModule", [
          await walletOwner.getAddress(),
        ])
      );
      await w.execTransactionFromModule(
        upgrader.address,
        0,
        upgrader.interface.encodeFunctionData("upgrade", [
          maliciousWallet.address,
        ]),
        1
      );
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
      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());
      await expect(
        entryPoint.handleOps([userOp], await offchainSigner.getAddress())
      ).to.be.reverted;
    }); */
  });
});
