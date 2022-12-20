import { expect } from "chai";
import { ethers } from "hardhat";

describe("Wallet Deployment", function () {
  it("Should deploy the wallet from proxy as intended", async function () {
    const accounts = await ethers.getSigners();
    const owner = await accounts[0].getAddress();
    // const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

    const create2FactoryAddress = "0xce0042B868300000d44A59004Da54A005ffdcf9f";

    const SmartWallet = await ethers.getContractFactory("SmartAccount");
    const baseImpl = await SmartWallet.deploy();
    await baseImpl.deployed();
    console.log("base wallet impl deployed at: ", baseImpl.address);

    const WalletFactory = await ethers.getContractFactory("SmartAccountFactory");
    const walletFactory = await WalletFactory.deploy(baseImpl.address);
    await walletFactory.deployed();
    console.log("wallet factory deployed at: ", walletFactory.address);

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

    const expected = await walletFactory.getAddressForCounterfactualWallet(
      owner,
      0
    );
    console.log("deploying new wallet..expected address: ", expected);

    await expect(
      walletFactory.deployCounterFactualWallet(
        owner,
        entryPoint.address,
        handler.address,
        0
      )
    )
      .to.emit(walletFactory, "SmartAccountCreated")
      .withArgs(expected, baseImpl.address, owner, "1.0.2", 0);

    // const deployed = await walletFactory.deployCounterFactualWallet(owner);
    // console.log("deployed new wallet..address: ", deployed);
  });
});
