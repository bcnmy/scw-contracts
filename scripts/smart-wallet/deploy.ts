import { ethers } from "hardhat";
async function main() {
  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
  const entryPointAddress =
    process.env.ENTRY_POINT_ADDRESS ||
    "0x0576a174D229E3cFA37253523E645A78A0C91B57";

  const SmartWallet = await ethers.getContractFactory("SmartAccount");
  const baseImpl = await SmartWallet.deploy(entryPointAddress);
  await baseImpl.deployed();
  console.log("base wallet impl deployed at: ", baseImpl.address);

  const WalletFactory = await ethers.getContractFactory("SmartAccountFactory");
  const walletFactory = await WalletFactory.deploy(baseImpl.address);
  await walletFactory.deployed();
  console.log("smart account factory deployed at: ", walletFactory.address);

  /* const DefaultHandler = await ethers.getContractFactory(
    "DefaultCallbackHandler"
  );
  const handler = await DefaultHandler.deploy();
  await handler.deployed();
  console.log("Default callback handler deployed at: ", handler.address); */

  const expected = await walletFactory.getAddressForCounterFactualAccount(
    owner,
    0
  );
  console.log("deploying new wallet..expected address: ", expected);

  const tx = await walletFactory.deployCounterFactualAccount(owner, 0);
  const receipt = await tx.wait();
  console.log("gas used to deploy account ", receipt.gasUsed.toNumber());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
