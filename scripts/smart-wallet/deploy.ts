import hre, { ethers } from "hardhat";
async function main() {
  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

  const SmartWallet = await ethers.getContractFactory("SmartAccount");
  const baseImpl = await SmartWallet.deploy();
  await baseImpl.deployed();
  console.log("base wallet impl deployed at: ", baseImpl.address);

  const WalletFactory = await ethers.getContractFactory("SmartAccountFactory");
  const walletFactory = await WalletFactory.deploy(baseImpl.address);
  await walletFactory.deployed();
  console.log("smart account factory deployed at: ", walletFactory.address);

  const expected = await walletFactory.getAddressForCounterfactualWallet(
    owner,
    0
  );
  console.log("deploying new wallet..expected address: ", expected);

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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
