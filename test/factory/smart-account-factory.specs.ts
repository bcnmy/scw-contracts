import { expect } from "chai";
import { ethers } from "hardhat";
import {
  SmartAccount,
  SmartAccountFactory,
  EntryPoint,
  EntryPoint__factory,
  MockToken,
  MultiSend,
  StorageSetter,
  DefaultCallbackHandler,
} from "../../typechain";

export async function deployEntryPoint(
  provider = ethers.provider
): Promise<EntryPoint> {
  const epf = await (await ethers.getContractFactory("EntryPoint")).deploy();
  return EntryPoint__factory.connect(epf.address, provider.getSigner());
}

export async function calculateProxyAddress(
  factory: SmartAccountFactory,
  singleton: string,
  handler: string,
  owner: string,
  index: number | string
): Promise<string> {
  const deploymentCode = ethers.utils.solidityPack(
    ["bytes", "uint256"],
    [await factory.accountCreationCode(), singleton]
  );
  const BaseImplementation = await ethers.getContractFactory("SmartAccount");
  const implIface = BaseImplementation.interface;
  const initializer = implIface.encodeFunctionData("init", [owner, handler]);
  const salt = ethers.utils.solidityKeccak256(
    ["bytes32", "uint256"],
    [ethers.utils.solidityKeccak256(["bytes"], [initializer]), index]
  );
  return ethers.utils.getCreate2Address(
    factory.address,
    salt,
    ethers.utils.keccak256(deploymentCode)
  );
}

describe("Smart Account Factory", function () {
  let entryPoint: EntryPoint;
  let walletOwner: Signer;
  let baseImpl: SmartAccount;
  let walletFactory: SmartAccountFactory;
  let token: MockToken;
  let multiSend: MultiSend;
  let storage: StorageSetter;
  let owner: string;
  let bob: string;
  let charlie: string;
  let userSCW: any;
  let deployer: Signer;
  let accounts: any;
  before(async () => {
    accounts = await ethers.getSigners();
    entryPoint = await deployEntryPoint();

    deployer = accounts[0];
    walletOwner = deployer;

    owner = await accounts[0].getAddress();
    bob = await accounts[1].getAddress();
    charlie = await accounts[2].getAddress();

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
  });

  describe("Counterfactual Account Deployment", function () {
    it("Should deploy the account from Factory as intended", async function () {
      const indexForSalt = 0;
      const accounts = await ethers.getSigners();
      const owner = await accounts[0].getAddress();

      const expected = await walletFactory.getAddressForCounterfactualAccount(
        owner,
        indexForSalt
      );
      console.log("deploying new wallet..expected address: ", expected);

      /* const tx = await walletFactory.deployCounterFactualAccount(
          baseImpl.address,
          initializer,
          indexForSalt
        );
        const receipt = await tx.wait();
        console.log("smart account deployment gas ", receipt.gasUsed.toNumber()); */

      const minimalHandler = await walletFactory.minimalHandler();
      const calculated = await calculateProxyAddress(
        walletFactory,
        baseImpl.address,
        minimalHandler,
        owner,
        indexForSalt
      );
      console.log("calculated address ", calculated);

      await expect(
        walletFactory.deployCounterFactualAccount(owner, indexForSalt)
      )
        .to.emit(walletFactory, "AccountCreation")
        .withArgs(expected, owner, indexForSalt);

      const userSCW: any = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expected
      );

      const queryImplementation = await userSCW.getImplementation();
      expect(queryImplementation).to.be.equal(baseImpl.address);
    });

    it("Should revert if we try to deploy already deployed account", async function () {
      const indexForSalt = 0;
      const accounts = await ethers.getSigners();
      const owner = await accounts[0].getAddress();
      // const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

      const expected = await walletFactory.getAddressForCounterfactualAccount(
        owner,
        indexForSalt
      );
      console.log("deploying account again..expected address: ", expected);
      await expect(
        walletFactory.deployCounterFactualAccount(owner, indexForSalt)
      ).to.be.revertedWith("Create2 call failed");
    });
  });

  describe("CREATE: Account Deployment", function () {
    it("Should deploy the account from Factory as intended", async function () {
      const accounts = await ethers.getSigners();
      const owner = await accounts[0].getAddress();
      // const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

      console.log(
        "deploying new account for same owner using create: should succeed"
      );

      await expect(walletFactory.deployAccount(owner)).to.emit(
        walletFactory,
        "AccountCreationWithoutIndex"
      );
      // .withArgs(expected, owner);
    });
  });
});
