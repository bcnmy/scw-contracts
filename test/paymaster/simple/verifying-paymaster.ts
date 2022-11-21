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
  VerifyingPaymaster,
  VerifyingPaymaster__factory,
  VerifyingPaymasterFactory,
  VerifyingPaymasterFactory__factory,
  WalletFactory,
  WalletFactory__factory,
  EntryPoint__factory,
} from "../../../typechain";
import { AddressZero } from "../../smart-wallet/testutils";
import { fillAndSign } from "../../utils/userOp";
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
  let walletOwner: Signer;
  let proxyPaymaster: Contract;
  let walletAddress: string, paymasterAddress: string;
  let ethersSigner;

  let offchainSigner: Signer, deployer: Signer;

  let verifyPaymasterImp: VerifyingPaymaster;
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
    walletOwner = ethersSigner[2];

    const deployerAddress = await deployer.getAddress();
    const offchainSignerAddress = await offchainSigner.getAddress();
    const walletOwnerAddress = await walletOwner.getAddress();

    console.log("walletOwner ", await walletOwner.getAddress());

    verifyPaymasterImp = await new VerifyingPaymaster__factory(
      deployer
    ).deploy();

    verifyPaymasterFactory = await new VerifyingPaymasterFactory__factory(
      deployer
    ).deploy(verifyPaymasterImp.address);

    const deployPaymasterTrx =
      await verifyPaymasterFactory.deployVerifyingPaymaster(
        walletOwnerAddress,
        offchainSignerAddress,
        entryPoint.address
      );
    const deployPaymasterTrxReceipt = await deployPaymasterTrx.wait();
    if (deployPaymasterTrxReceipt) {
      const events = deployPaymasterTrxReceipt.events;
      if (events) {
        const event = events[1];
        paymasterAddress = event.args![0];
      }
    }
    console.log(" paymasterAddress ", paymasterAddress);

    smartWalletImp = await new SmartWallet__factory(deployer).deploy();

    walletFactory = await new WalletFactory__factory(deployer).deploy(
      smartWalletImp.address
    );

    callBackHandler = await new DefaultCallbackHandler__factory(
      deployer
    ).deploy();

    const walletDeploymentTrx = await walletFactory.deployCounterFactualWallet(
      walletOwnerAddress,
      entryPoint.address,
      callBackHandler.address,
      0
    );
    const expected = await walletFactory.getAddressForCounterfactualWallet(
      walletOwnerAddress,
      0
    );
    // const walletDeploymentTrxReceipt = await walletDeploymentTrx.wait();
    /* if (walletDeploymentTrxReceipt) {
      const events = walletDeploymentTrxReceipt.events;
      if (events) {
        const event = events[1];
        if (event.args) {
          walletAddress = event.args[0];
        }
      }
    } */
    walletAddress = expected;
    console.log(" wallet address ", walletAddress);

    proxyPaymaster = new ethers.Contract(
      paymasterAddress,
      verifyPaymasterImp.interface,
      walletOwner
    );
    await proxyPaymaster.addStake(0, { value: parseEther("2") });
    await entryPoint.depositTo(paymasterAddress, { value: parseEther("1") });
    const resultSet = await entryPoint.getDepositInfo(paymasterAddress);
    console.log("deposited state ", resultSet);
  });

  describe("#validatePaymasterUserOp", () => {
    it("should reject on no signature", async () => {
      const userOp = await fillAndSign(
        {
          sender: walletAddress,
          paymasterAndData: hexConcat([paymasterAddress, "0x1234"]),
        },
        walletOwner,
        entryPoint
      );
      await expect(
        entryPointStatic.callStatic.simulateValidation(userOp, false)
      ).to.be.revertedWith("invalid signature length in paymasterAndData");
    });

    it("should reject on invalid signature", async () => {
      const userOp = await fillAndSign(
        {
          sender: walletAddress,
          paymasterAndData: hexConcat([
            paymasterAddress,
            "0x" + "1c".repeat(65),
          ]),
        },
        walletOwner,
        entryPoint
      );
      await expect(
        entryPointStatic.callStatic.simulateValidation(userOp, false)
      ).to.be.revertedWith("ECDSA: invalid signature");
    });

    it("succeed with valid signature", async () => {
      const userOp1 = await fillAndSign(
        {
          sender: walletAddress,
        },
        walletOwner,
        entryPoint
      );
      const hash = await proxyPaymaster.getHash(userOp1);
      const sig = await offchainSigner.signMessage(arrayify(hash));
      const userOp = await fillAndSign(
        {
          ...userOp1,
          paymasterAndData: hexConcat([paymasterAddress, sig]),
        },
        walletOwner,
        entryPoint
      );
      await entryPointStatic.callStatic.simulateValidation(userOp, false);
    });
  });
});
