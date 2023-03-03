import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
  SmartWallet,
  WalletFactory,
  EntryPoint__factory,
  VerifyingSingletonPaymaster__factory,
  EntryPoint,
  VerifyingSingletonPaymaster,
  MockToken,
  MultiSend,
  StorageSetter,
  DefaultCallbackHandler,
} from "../../typechain";
import { fillAndSign } from "../utils/userOp";
import { arrayify, hexConcat, parseEther } from "ethers/lib/utils";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

describe("Account Functionality: 4337", function () {
  let entryPoint: EntryPoint;
  let walletOwner: Signer;
  // let whitelistModule: WhitelistModule;
  let walletAddress: string, paymasterAddress: string;
  let ethersSigner;

  let offchainSigner: Signer, deployer: Signer;

  let verifyingSingletonPaymaster: VerifyingSingletonPaymaster;
  let baseImpl: SmartWallet;
  let walletFactory: WalletFactory;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let owner: string;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  let handler: DefaultCallbackHandler;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();
    ethersSigner = await ethers.getSigners();
    entryPoint = await deployEntryPoint();

    deployer = ethersSigner[0];
    offchainSigner = ethersSigner[1];
    walletOwner = deployer;

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();

    const offchainSignerAddress = await offchainSigner.getAddress();
    const walletOwnerAddress = await walletOwner.getAddress();

    verifyingSingletonPaymaster =
      await new VerifyingSingletonPaymaster__factory(deployer).deploy(
        await deployer.getAddress(),
        entryPoint.address,
        offchainSignerAddress
      );
    console.log(
      "verifyingSingletonPaymaster: ",
      verifyingSingletonPaymaster.deployTransaction.gasLimit.toNumber()
    );

    const DefaultHandler = await ethers.getContractFactory(
      "DefaultCallbackHandler"
    );
    handler = await DefaultHandler.deploy();
    await handler.deployed();
    console.log(
      "Default callback handler: ",
      handler.deployTransaction.gasLimit.toNumber()
    );

    const BaseImplementation = await ethers.getContractFactory("SmartAccount");
    baseImpl = await BaseImplementation.deploy(entryPoint.address);
    await baseImpl.deployed();
    console.log(
      "BaseWallet impl: ",
      baseImpl.deployTransaction.gasLimit.toNumber()
    );

    const WalletFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    walletFactory = await WalletFactory.deploy();
    await walletFactory.deployed();
    console.log(
      "Wallet factory: ",
      walletFactory.deployTransaction.gasLimit.toNumber()
    );

    const MockToken = await ethers.getContractFactory("MockToken");
    token = await MockToken.deploy();
    await token.deployed();
    console.log("Mock ERC20: ", token.deployTransaction.gasLimit.toNumber());

    const Storage = await ethers.getContractFactory("StorageSetter");
    storage = await Storage.deploy();
    console.log(
      "Storage setter: ",
      storage.deployTransaction.gasLimit.toNumber()
    );

    const MultiSend = await ethers.getContractFactory("MultiSend");
    multiSend = await MultiSend.deploy();
    console.log(
      "Multisend helper: ",
      multiSend.deployTransaction.gasLimit.toNumber()
    );

    await token.mint(owner, ethers.utils.parseEther("1000000"));

    const initializer = BaseImplementation.interface.encodeFunctionData(
      "init",
      [walletOwnerAddress, handler.address]
    );

    const tx = await walletFactory.deployCounterFactualWallet(
      baseImpl.address,
      initializer,
      0
    );
    const expected = await walletFactory.getAddressForCounterfactualWallet(
      baseImpl.address,
      initializer,
      0
    );

    walletAddress = expected;
    console.log("SmartAccount: ", tx.gasLimit.toNumber());

    userSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      expected
    );
    const entryPointAddress = await userSCW.entryPoint();
    expect(entryPointAddress).to.equal(entryPoint.address);

    paymasterAddress = verifyingSingletonPaymaster.address;

    await entryPoint.depositTo(paymasterAddress, { value: parseEther("1") });
  });

  it("4337 flow: estimate send erc20 transaction gasUsed", async () => {
    // deposit for the pasymaster
    await verifyingSingletonPaymaster.depositFor(
      await offchainSigner.getAddress(),
      { value: ethers.utils.parseEther("1") }
    );

    // transfer erc20 token to the wallet
    await token
      .connect(accounts[0])
      .transfer(userSCW.address, ethers.utils.parseEther("100"));

    const SmartAccount = await ethers.getContractFactory("SmartAccount");
    // encode transfer erc20 token data
    const erc20Interface = new ethers.utils.Interface([
      "function transfer(address _to, uint256 _value)",
    ]);
    // Encode an ERC-20 token transfer to recipient of the specified amount
    const transferData = erc20Interface.encodeFunctionData("transfer", [
      bob,
      ethers.utils.parseEther("1"),
    ]);
    // encode executeCall function data with transfer erc20 token data
    const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
      token.address,
      0,
      transferData,
    ]);

    const userOp1 = await fillAndSign(
      {
        sender: walletAddress,
        callData: txnData,
        verificationGasLimit: 200000,
      },
      walletOwner,
      entryPoint
    );
    const nonceFromContract = await verifyingSingletonPaymaster[
      "getSenderPaymasterNonce(address)"
    ](walletAddress);

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
      nonceFromContract.toNumber(),
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
      entryPoint
    );

    const tx = await entryPoint.handleOps(
      [userOp],
      await offchainSigner.getAddress()
    );
    console.log(
      "4337 flow: estimate send erc20 transaction gasUsed: ",
      tx.gasLimit.toNumber()
    );

    // check updated balance of the wallet and bob
    const balanceSCW = await token.balanceOf(userSCW.address);
    const balanceBob = await token.balanceOf(bob);
    expect(balanceSCW).to.equal(ethers.utils.parseEther("99"));
    expect(balanceBob).to.equal(ethers.utils.parseEther("1"));
  });

  it("4337 flow: estimate wallet deployment + send erc20 transaction gasUsed with multisend", async () => {
    // create new SCW but dont deployCounterFactualWallet
    const SmartAccount = await ethers.getContractFactory("SmartAccount");
    const initializer = SmartAccount.interface.encodeFunctionData("init", [
      charlie,
      handler.address,
    ]);
    const expectedWallet =
      await walletFactory.getAddressForCounterfactualWallet(
        baseImpl.address,
        initializer,
        0
      );
    console.log("wallet address address: ", expectedWallet);
    const newUserSCW = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      expectedWallet
    );

    // transfer erc20 token to the new wallet
    await token
      .connect(accounts[0])
      .transfer(newUserSCW.address, ethers.utils.parseEther("100"));

    // encode transfer erc20 token data
    const erc20Interface = new ethers.utils.Interface([
      "function transfer(address _to, uint256 _value)",
    ]);
    // Encode an ERC-20 token transfer to recipient of the specified amount
    const transferData = erc20Interface.encodeFunctionData("transfer", [
      bob,
      ethers.utils.parseEther("1"),
    ]);
    // encode executeCall function data with transfer erc20 token data
    const txnData = SmartAccount.interface.encodeFunctionData("executeCall", [
      token.address,
      0,
      transferData,
    ]);
    console.log("txnData: ");

    const userOp1 = await fillAndSign(
      {
        sender: newUserSCW.address,
        callData: txnData,
        verificationGasLimit: 200000,
        initCode: initializer,
      },
      accounts[2],
      entryPoint
    );
    console.log("userOp1: ", userOp1);
    const nonceFromContract = await verifyingSingletonPaymaster[
      "getSenderPaymasterNonce(address)"
    ](newUserSCW.address);

    const hash = await verifyingSingletonPaymaster.getHash(
      userOp1,
      nonceFromContract.toNumber(),
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
      accounts[2],
      entryPoint
    );
    console.log("userOp: ", userOp);
    const tx = await entryPoint.handleOps(
      [userOp],
      await offchainSigner.getAddress()
    );
    console.log("gasUsed: ", tx.gasLimit.toNumber());

    // check updated balance of the wallet and bob
    const balanceSCW = await token.balanceOf(newUserSCW.address);
    const balanceBob = await token.balanceOf(bob);
    expect(balanceSCW).to.equal(ethers.utils.parseEther("99"));
    expect(balanceBob).to.equal(ethers.utils.parseEther("2"));
  });
});
