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
  const nonceFromContract = await paymaster["getSenderPaymasterNonce(address)"](
    smartAccountAddress
  );

  const hash = await paymaster.getHash(
    userOp,
    nonceFromContract.toNumber(),
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
    entryPoint
  );
  return userOpWithPaymasterData;
}

describe("Smart Account tests", function () {
  let entryPoint: EntryPoint;
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

  describe("transfer: take native tokens out of Smart Account", function () {
    it("success if enough tokens and owner call", async () => {
      // deploying wallet first
      await walletFactory.deployCounterFactualAccount(owner, 0);
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterfactualAccount(owner, 0);
      // balance of scw before deposit
      let balance = await ethers.provider.getBalance(
        expectedSmartAccountAddress
      );
      expect(balance).to.equal(0);
      // transfer 1 ETH to smart account
      tx = await accounts[0].sendTransaction({
        to: expectedSmartAccountAddress,
        value: parseEther("1"),
      });
      await tx.wait();
      balance = await ethers.provider.getBalance(expectedSmartAccountAddress);
      expect(balance).to.equal(parseEther("1"));

      // transfer 0.5 ETH from smart account to bob by owner signature
      const bobBalanceBefore = await ethers.provider.getBalance(bob);
      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );
      tx = await userSCW.connect(accounts[0]).transfer(bob, parseEther("0.5"));
      await tx.wait();

      expect(await ethers.provider.getBalance(bob)).to.equal(
        bobBalanceBefore.add(parseEther("0.5"))
      );
      expect(
        await ethers.provider.getBalance(expectedSmartAccountAddress)
      ).to.equal(parseEther("0.5"));
    });

    it("fail via the entry point call", async () => {
      // const expectedSmartAccountAddress =
      //   await walletFactory.getAddressForCounterfactualAccount(owner, 0);
      // const SmartAccount = await ethers.getContractFactory("SmartAccount");
      // const txnData = SmartAccount.interface.encodeFunctionData("transfer", [
      //   bob,
      //   ethers.utils.parseEther("0.5"),
      // ]);
      // const userOp1 = await fillAndSign(
      //   {
      //     sender: expectedSmartAccountAddress,
      //     callData: txnData,
      //     verificationGasLimit: 200000,
      //   },
      //   walletOwner,
      //   entryPoint
      // );
      // console.log("userOp1: ", userOp1);
      // // Set paymaster data in UserOp
      // const userOp = await getUserOpWithPaymasterData(
      //   verifyingSingletonPaymaster,
      //   expectedSmartAccountAddress,
      //   userOp1,
      //   offchainSigner,
      //   paymasterAddress,
      //   walletOwner,
      //   entryPoint
      // );
      // const tx = entryPoint.handleOps(
      //   [userOp],
      //   await offchainSigner.getAddress()
      // );
      // console.log("tx hash: ", tx);
      // await expect(tx).to.be.reverted;
    });

    it("fail if not enough tokens", async () => {
      tx = userSCW.connect(accounts[0]).transfer(bob, parseEther("1"));
      await expect(tx).to.be.reverted;
    });
  });

  describe("pullTokens: take ERC20 tokens out of Smart Account", function () {
    it("success if enough tokens and owner call", async () => {
      // transfer 1000 tokens to smart account
      tx = await token.transfer(userSCW.address, parseEther("1000"));
      await tx.wait();
      expect(await token.balanceOf(userSCW.address)).to.equal(
        parseEther("1000")
      );
      // transfer 500 tokens from smart account to bob by owner signature
      const bobBalanceBefore = await token.balanceOf(bob);
      tx = await userSCW
        .connect(accounts[0])
        .pullTokens(token.address, bob, parseEther("500"));
      await tx.wait();
      expect(await token.balanceOf(bob)).to.equal(
        bobBalanceBefore.add(parseEther("500"))
      );
      expect(await token.balanceOf(userSCW.address)).to.equal(
        parseEther("500")
      );
    });

    it("fail if not enough tokens", async () => {
      tx = userSCW
        .connect(accounts[0])
        .pullTokens(token.address, bob, parseEther("1000"));
      await expect(tx).to.be.reverted;
    });
  });

  describe("add and withdraw: deposit ETH for Smart Account in entry point", function () {
    it("addDeposit: successfully add deposit", async () => {
      // balance of scw before deposit
      const entryPointBalBefore = await userSCW
        .connect(accounts[0])
        .getDeposit();
      console.log("entryPointBalBefore: ", entryPointBalBefore.toString());
      expect(entryPointBalBefore).to.equal(0);
      // add 2 ETH to entry point
      tx = await userSCW.connect(accounts[0]).addDeposit({
        value: parseEther("2"),
      });
      await tx.wait();
      const entryPointBalAfter = await userSCW
        .connect(accounts[0])
        .getDeposit();
      console.log("entryPointBalAfter: ", entryPointBalAfter.toString());
      expect(entryPointBalAfter).to.equal(parseEther("2"));
    });

    it("withdrawDepositTo: scw account", async () => {
      const entryPointBalBefore = await userSCW
        .connect(accounts[0])
        .getDeposit();
      expect(entryPointBalBefore).to.equal(parseEther("2"));
      tx = await userSCW
        .connect(accounts[0])
        .withdrawDepositTo(userSCW.address, parseEther("1"));

      await tx.wait();
      const entryPointBalAfter = await userSCW
        .connect(accounts[0])
        .getDeposit();
      console.log("entryPointBalAfter: ", entryPointBalAfter.toString());
      expect(entryPointBalAfter).to.equal(parseEther("1"));
    });
  });
});
