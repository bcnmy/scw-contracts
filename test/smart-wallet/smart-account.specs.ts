import { expect } from "chai";
import { ethers } from "hardhat";
import {
  SmartAccount,
  SmartAccountFactory,
  EntryPoint,
  EntryPointWithNonces,
  SocialRecoveryModule,
  WhitelistModule,
  EntryPoint__factory,
  EntryPointWithNonces__factory,
  VerifyingSingletonPaymaster,
  VerifyingSingletonPaymaster__factory,
  MockToken,
  MultiSend,
  StorageSetter,
} from "../../typechain";
import { Signer } from "ethers";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";
import { encodeTransfer } from "./testUtils";
import { fillAndSign, fillUserOp } from "../utils/userOp";
import { UserOperation } from "../utils/userOperation";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

export async function deployEntryPointWithNonces(
  provider = ethers.provider
): Promise<EntryPointWithNonces> {
  const epwnf = await (await ethers.getContractFactory("EntryPointWithNonces")).deploy();
  return EntryPointWithNonces__factory.connect(epwnf.address, provider.getSigner());
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
  let entryPointWithNonces: EntryPointWithNonces;
  let baseImpl: SmartAccount;
  let baseImpl2: SmartAccount;
  let verifyingSingletonPaymaster: VerifyingSingletonPaymaster;
  let paymasterAddress: string;
  let verifyingSingletonPaymaster2: VerifyingSingletonPaymaster;
  let paymasterAddress2: string;
  let whitelistModule: WhitelistModule;
  let socialRecoveryModule: SocialRecoveryModule;
  let walletFactory: SmartAccountFactory;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let offchainSigner: Signer; 
  let deployer: Signer; 
  let owner: string;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  let accounts: any;
  let tx: any;
  let prevNonce: any;

  before(async () => {
    accounts = await ethers.getSigners();
    entryPoint = await deployEntryPoint();
    entryPointWithNonces = await deployEntryPointWithNonces();

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();

    deployer = accounts[0];
    offchainSigner = accounts[3];

    const offchainSignerAddress = await offchainSigner.getAddress();

    verifyingSingletonPaymaster =
      await new VerifyingSingletonPaymaster__factory(deployer).deploy(
        await deployer.getAddress(),
        entryPoint.address,
        offchainSignerAddress
    );
    paymasterAddress = verifyingSingletonPaymaster.address;

    verifyingSingletonPaymaster2 =
      await new VerifyingSingletonPaymaster__factory(deployer).deploy(
        await deployer.getAddress(),
        entryPointWithNonces.address,
        offchainSignerAddress
    );
    paymasterAddress2 = verifyingSingletonPaymaster2.address;

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

    await verifyingSingletonPaymaster
      .connect(deployer)
      .addStake(10, { value: parseEther("2") });
    console.log("paymaster staked");

    await verifyingSingletonPaymaster.depositFor(
      await offchainSigner.getAddress(),
      { value: ethers.utils.parseEther("1") }
    );

    await verifyingSingletonPaymaster2
      .connect(deployer)
      .addStake(10, { value: parseEther("2") });
    console.log("paymaster2 staked");

    await verifyingSingletonPaymaster2.depositFor(
      await offchainSigner.getAddress(),
      { value: ethers.utils.parseEther("1") }
    );

    await entryPoint.depositTo(paymasterAddress, { value: parseEther("10") });
    await entryPointWithNonces.depositTo(paymasterAddress2, { value: parseEther("10") });

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

  describe("Nonces: local and semi-abstracted", function () {
    it("can send the userOp while the EP does not support semi-abstracted nonces yet", async () => {

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      await accounts[1].sendTransaction({
          from: bob,
          to: expectedSmartAccountAddress,
          value: ethers.utils.parseEther("5"),
      });

      const scwNonceBefore = await userSCW.nonce();
      const charlieBalBefore = await ethers.provider.getBalance(charlie);

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        charlie,
        ethers.utils.parseEther("1"),
        "0x",
      ]);
      
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnData,
          verificationGasLimit: 200000,
        },
        accounts[0], //owner
        entryPoint
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        paymasterAddress,
        accounts[0], //owner
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

      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());

      const balCharlieActual = await ethers.provider.getBalance(charlie);
      expect(balCharlieActual).to.be.equal(
        charlieBalBefore.add(ethers.utils.parseEther("1"))
      );

      const scwNonceAfter = await userSCW.nonce();
      expect(scwNonceAfter).to.be.equal(scwNonceBefore.add(1));
      
      //console.log("scwNonceAfter: ", scwNonceAfter.toString());

      prevNonce = scwNonceAfter;
      
    });

    it("can send the next userOp with the same EP and the nonce is increased", async () => {

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      await accounts[1].sendTransaction({
          from: bob,
          to: expectedSmartAccountAddress,
          value: ethers.utils.parseEther("5"),
      });

      const scwNonceBefore = await userSCW.nonce();
      const charlieBalBefore = await ethers.provider.getBalance(charlie);

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        charlie,
        ethers.utils.parseEther("1"),
        "0x",
      ]);
      
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnData,
          verificationGasLimit: 200000,
        },
        accounts[0], //owner
        entryPoint
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        paymasterAddress,
        accounts[0], //owner
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

      await entryPoint.handleOps([userOp], await offchainSigner.getAddress());

      const balCharlieActual = await ethers.provider.getBalance(charlie);
      expect(balCharlieActual).to.be.equal(
        charlieBalBefore.add(ethers.utils.parseEther("1"))
      );

      const scwNonceAfter = await userSCW.nonce();
      expect(scwNonceAfter).to.be.equal(scwNonceBefore.add(1));
      expect(scwNonceAfter).to.be.equal(prevNonce.add(1));
      
      //console.log("scwNonceAfter: ", scwNonceAfter.toString());
      
    });

    // can update wallet to a new implementation (with a new EP)
    it("Can update wallet to a new implementation (with a new EP)", async () => {

      const BaseImplementation = await ethers.getContractFactory("SmartAccount");
      baseImpl2 = await BaseImplementation.deploy(entryPointWithNonces.address);
      await baseImpl2.deployed();
      console.log("base wallet impl with new EntryPointWithNonces deployed at: ", baseImpl2.address);

      await userSCW.updateImplementation(baseImpl2.address);

      expect(await userSCW.getImplementation()).to.equal(baseImpl2.address);
      expect(await userSCW.nonce()).to.equal(0);

      // no problems with 0 being the working nonce again
      // that cannot cause “replay attack”, since the authorization of this UserOp (signature) 
      // should be valid for this EntryPoint, on this chainid only.
      // https://docs.google.com/document/d/1MywdH_TCkyEjD3QusLZ_kUZg4ZEI00qp97mBze9JI4k
    
    });

    it("can send a userOp with the new EP and it successfully goes thru", async () => {

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      await accounts[1].sendTransaction({
          from: bob,
          to: expectedSmartAccountAddress,
          value: ethers.utils.parseEther("5"),
      });

      const scwNonceBefore = await userSCW.nonce();
      const charlieBalBefore = await ethers.provider.getBalance(charlie);

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        charlie,
        ethers.utils.parseEther("1"),
        "0x",
      ]);
      
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnData,
          verificationGasLimit: 200000,
        },
        accounts[0], //owner
        entryPointWithNonces
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster2,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        paymasterAddress2,
        accounts[0], //owner
        entryPointWithNonces
      );

      const uerOpHash = await entryPointWithNonces?.getUserOpHash(userOp);

      const VerifyingPaymaster = await ethers.getContractFactory(
        "VerifyingSingletonPaymaster"
      );

      const validatePaymasterUserOpData =
        VerifyingPaymaster.interface.encodeFunctionData(
          "validatePaymasterUserOp",
          [userOp, uerOpHash, 10]
        );
      
      const gasEstimatedValidateUserOp = await ethers.provider.estimateGas({
        from: entryPointWithNonces?.address,
        to: paymasterAddress2,
        data: validatePaymasterUserOpData, // validatePaymasterUserOp calldata
      });

      console.log(
        "Gaslimit for validate paymaster userOp is: ",
        gasEstimatedValidateUserOp
      );

      await entryPointWithNonces.handleOps([userOp], await offchainSigner.getAddress());

      const balCharlieActual = await ethers.provider.getBalance(charlie);
      expect(balCharlieActual).to.be.equal(
        charlieBalBefore.add(ethers.utils.parseEther("1"))
      );

      const scwNonceAfter = await userSCW.nonce();
      expect(scwNonceAfter).to.be.equal(scwNonceBefore.add(1));
      
      //console.log("scwNonceAfter: ", scwNonceAfter.toString());

      prevNonce = scwNonceAfter;
      
    });

    it("can send the next userOp with the new EP and it successfully goes thru with the increased nonce", async () => {

      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 0);

      await accounts[1].sendTransaction({
          from: bob,
          to: expectedSmartAccountAddress,
          value: ethers.utils.parseEther("5"),
      });

      const scwNonceBefore = await userSCW.nonce();
      const charlieBalBefore = await ethers.provider.getBalance(charlie);

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
        charlie,
        ethers.utils.parseEther("1"),
        "0x",
      ]);
      
      const userOp1 = await fillAndSign(
        {
          sender: expectedSmartAccountAddress,
          callData: txnData,
          verificationGasLimit: 200000,
        },
        accounts[0], //owner
        entryPointWithNonces
      );

      // Set paymaster data in UserOp
      const userOp = await getUserOpWithPaymasterData(
        verifyingSingletonPaymaster2,
        expectedSmartAccountAddress,
        userOp1,
        offchainSigner,
        paymasterAddress2,
        accounts[0], //owner
        entryPointWithNonces
      );

      const uerOpHash = await entryPointWithNonces?.getUserOpHash(userOp);

      const VerifyingPaymaster = await ethers.getContractFactory(
        "VerifyingSingletonPaymaster"
      );

      const validatePaymasterUserOpData =
        VerifyingPaymaster.interface.encodeFunctionData(
          "validatePaymasterUserOp",
          [userOp, uerOpHash, 10]
        );
      
      const gasEstimatedValidateUserOp = await ethers.provider.estimateGas({
        from: entryPointWithNonces?.address,
        to: paymasterAddress2,
        data: validatePaymasterUserOpData, // validatePaymasterUserOp calldata
      });

      console.log(
        "Gaslimit for validate paymaster userOp is: ",
        gasEstimatedValidateUserOp
      );

      await entryPointWithNonces.handleOps([userOp], await offchainSigner.getAddress());

      const balCharlieActual = await ethers.provider.getBalance(charlie);
      expect(balCharlieActual).to.be.equal(
        charlieBalBefore.add(ethers.utils.parseEther("1"))
      );

      const scwNonceAfter = await userSCW.nonce();
      expect(scwNonceAfter).to.be.equal(scwNonceBefore.add(1));
      expect(scwNonceAfter).to.be.equal(prevNonce.add(1));

      //console.log("scwNonceAfter: ", scwNonceAfter.toString());

    });

  });

});
