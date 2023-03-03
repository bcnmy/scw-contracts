import hre, { ethers } from "hardhat";
async function main() {
  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
  const entryPointAddress =
    process.env.ENTRY_POINT_ADDRESS ||
    "0x27a4Db290B89AE3373ce4313cBEaE72112Ae7Da9";
  const fallbackHandlerAddress =
    process.env.FALLBACK_HANDLER_ADDRESS ||
    "0x4a3581e10ac4BDd4Da32dE5eBea80C2840255E7a";

  const SmartWallet = await ethers.getContractFactory("SmartAccount");
  const baseImpl = await SmartWallet.deploy(entryPointAddress);
  await baseImpl.deployed();
  console.log("base wallet impl deployed at: ", baseImpl.address);

  const WalletFactory = await ethers.getContractFactory("SmartAccountFactory");
  const walletFactory = await WalletFactory.deploy();
  await walletFactory.deployed();
  console.log("smart account factory deployed at: ", walletFactory.address);

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
    baseImpl.address,
    handler.address,
    owner,
    0
  );
  console.log("deploying new wallet..expected address: ", expected);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
