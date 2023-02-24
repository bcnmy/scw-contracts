import { expect } from "chai";
import { ethers } from "hardhat";
import { Proxy } from "../../typechain";

describe("Proxy Deployment", function () {
  it("Should deploy the wallet from proxy as intended", async function () {
    const indexForSalt = 0;
    const accounts = await ethers.getSigners();
    const owner = await accounts[0].getAddress();
    // const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    const entryPoint = await EntryPoint.deploy();
    await entryPoint.deployed();
    console.log("Entry point deployed at: ", entryPoint.address);

    const DefaultHandler = await ethers.getContractFactory(
      "DefaultCallbackHandler"
    );
    const handler = await DefaultHandler.deploy();
    await handler.deployed();
    console.log("Default callback handler deployed at: ", handler.address);

    const SmartWallet = await ethers.getContractFactory("SmartAccount");
    const baseImpl = await SmartWallet.deploy(entryPoint.address);
    await baseImpl.deployed();
    console.log("base wallet impl deployed at: ", baseImpl.address);

    const WalletFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    const walletFactory = await WalletFactory.deploy(
      baseImpl.address,
      handler.address
    );
    await walletFactory.deployed();
    console.log("wallet factory deployed at: ", walletFactory.address);

    const expected = await walletFactory.getAddressForCounterfactualWallet(
      owner,
      indexForSalt
    );
    console.log("deploying new wallet..expected address: ", expected);

    /* const tx = await walletFactory.deployCounterFactualWallet(
      owner,
      indexForSalt
    );
    const receipt = await tx.wait();
    console.log("smart account deployment gas ", receipt.gasUsed.toNumber()); */

    await expect(walletFactory.deployCounterFactualWallet(owner, indexForSalt))
      .to.emit(walletFactory, "AccountCreation")
      .withArgs(expected, baseImpl.address);

    const userSCW: any = await ethers.getContractAt(
      "contracts/smart-contract-wallet/SmartAccount.sol:SmartAccount",
      expected
    );

    const queryImplementation = await userSCW.accountLogic();
    expect(queryImplementation).to.be.equal(baseImpl.address);
  });
});
