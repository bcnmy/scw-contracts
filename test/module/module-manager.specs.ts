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
import { fillAndSign, fillUserOp } from "../utils/userOp";
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

describe("Module transactions via AA flow", function () {
  let entryPoint: EntryPoint;
  let walletOwner: Signer;
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
  let userSCW: any;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();
    entryPoint = await deployEntryPoint();

    walletOwner = accounts[0];

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

  describe("Module transactions from Smart Account", function () {
    it("can enable modules and accept transactions from it", async function () {
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 10);

      // deploying now
      await walletFactory.deployCounterFactualAccount(owner, 10);

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      const code = await ethers.provider.getCode(expectedSmartAccountAddress);
      console.log("wallet code is: ", code);

      await token
        .connect(accounts[0])
        .transfer(expectedSmartAccountAddress, ethers.utils.parseEther("100"));

      // whitelisting target contract
      await whitelistModule
        .connect(accounts[1])
        .whitelistDestination(token.address);

      // Owner itself can not directly add modules
      await expect(
        userSCW.connect(accounts[0]).enableModule(whitelistModule.address)
      ).to.be.reverted;

      // Without enabling module one can't send transactions
      // invoking safe from module without enabling it!
      await expect(
        whitelistModule
          .connect(accounts[2])
          .authCall(
            userSCW.address,
            token.address,
            ethers.utils.parseEther("0"),
            encodeTransfer(charlie, ethers.utils.parseEther("10").toString())
          )
      ).to.be.reverted;

      // Modules can only be enabled via safe transaction
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "enableModule",
          [whitelistModule.address],
          [accounts[0]]
        )
      ).to.emit(userSCW, "ExecutionSuccess");

      expect(await token.balanceOf(charlie)).to.equal(
        ethers.utils.parseEther("0")
      );

      // invoking module!
      await whitelistModule
        .connect(accounts[2])
        .authCall(
          userSCW.address,
          token.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie, ethers.utils.parseEther("10").toString())
        );

      expect(await token.balanceOf(charlie)).to.equal(
        ethers.utils.parseEther("10")
      );
    });

    it("disable module", async function () {
      // Now here the wallet with owner and index 10 should have been deployed
      const expectedSmartAccountAddress =
        await walletFactory.getAddressForCounterFactualAccount(owner, 10);

      userSCW = await ethers.getContractAt(
        "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
        expectedSmartAccountAddress
      );

      const code = await ethers.provider.getCode(expectedSmartAccountAddress);
      console.log("wallet code is: ", code);

      await token
        .connect(accounts[0])
        .transfer(expectedSmartAccountAddress, ethers.utils.parseEther("100"));

      // Owner itself can not directly add modules
      await expect(
        userSCW.connect(accounts[0]).enableModule(whitelistModule.address)
      ).to.be.reverted;

      // Can't enable module which is already enabled!
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "enableModule",
          [whitelistModule.address],
          [accounts[0]]
        )
      ).to.be.reverted;

      const isEnabled = await userSCW.isModuleEnabled(whitelistModule.address);
      expect(isEnabled).to.be.equal(true);

      /* expect(
        await userSCW.getModulesPaginated(AddressOne, 10)
      ).to.be.deep.equal([[whitelistModule.address], AddressOne]); */

      // Disabling module
      // it("can not set sentinel"
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "disableModule",
          [AddressOne, AddressOne],
          [accounts[0]]
        )
      ).to.be.reverted;

      // Disabling module
      // it("can not set 0 Address"
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "disableModule",
          [AddressOne, AddressZero],
          [accounts[0]]
        )
      ).to.be.reverted;

      // Disabling module
      //  it("Invalid prevModule, module pair provided - Invalid sentinel"
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "disableModule",
          [AddressZero, whitelistModule.address],
          [accounts[0]]
        )
      ).to.be.reverted;

      // Disabling module
      await expect(
        executeContractCallWithSigners(
          userSCW,
          userSCW,
          "disableModule",
          [AddressOne, whitelistModule.address],
          [accounts[0]]
        )
      ).to.emit(userSCW, "ExecutionSuccess");

      // invoking module!
      // Should not succeed
      await expect(
        whitelistModule
          .connect(accounts[2])
          .authCall(
            userSCW.address,
            token.address,
            ethers.utils.parseEther("0"),
            encodeTransfer(charlie, ethers.utils.parseEther("10").toString())
          )
      ).to.be.reverted;

      // Balance is still 10!
      expect(await token.balanceOf(charlie)).to.equal(
        ethers.utils.parseEther("10")
      );
    });
  });
});
