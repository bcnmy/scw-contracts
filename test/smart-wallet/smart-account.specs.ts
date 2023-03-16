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
} from "../../typechain";
import { Signer } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { encodeTransfer } from "./testUtils";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

export const AddressZero = "0x0000000000000000000000000000000000000000";
export const AddressOne = "0x0000000000000000000000000000000000000001";

describe("Smart Account tests", function () {
  let entryPoint: EntryPoint;
  let baseImpl: SmartAccount;
  let whitelistModule: WhitelistModule;
  let socialRecoveryModule: SocialRecoveryModule;
  let walletFactory: SmartAccountFactory;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let owner: string;
  let bob: string;
  let userSCW: any;
  let accounts: any;
  let tx: any;

  before(async () => {
    accounts = await ethers.getSigners();
    entryPoint = await deployEntryPoint();

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();

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
  });

  describe("transfer: take native tokens out of Smart Account", function () {
    it("success if enough tokens and owner call", async () => {
      // deploying wallet first
      await walletFactory.deployCounterFactualAccount(owner, 0);
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);
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

  describe("executeCall: can withdraw tokens from entry point", function () {
    it("fail if called by not owner or entry point", async () => {
      expect(await token.balanceOf(userSCW.address)).to.equal(
        parseEther("500")
      );
      const txData = encodeTransfer(
        bob,
        ethers.utils.parseEther("500").toString()
      );
      tx = userSCW
        .connect(accounts[1]) // via bob
        .executeCall(token.address, 0, txData);
      await expect(tx).to.be.revertedWith("CallerIsNotEntryPointOrOwner");
      expect(await token.balanceOf(userSCW.address)).to.equal(
        parseEther("500")
      );
    });

    it("success if called by the owner", async () => {
      expect(await token.balanceOf(userSCW.address)).to.equal(
        parseEther("500")
      );
      const txData = encodeTransfer(
        bob,
        ethers.utils.parseEther("500").toString()
      );
      tx = await userSCW
        .connect(accounts[0]) // via owner
        .executeCall(token.address, 0, txData);
      await tx.wait();
      expect(await token.balanceOf(userSCW.address)).to.equal(0);
    });
  });

  describe("supportsInterface: ERC165", function () {
    it("should support ERC165", async () => {
      tx = await userSCW.supportsInterface("0x01ffc9a7");
      console.log("tx: ", tx);
      expect(tx).to.equal(true);
    });
  });
});
