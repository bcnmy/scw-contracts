import hre, { ethers } from "hardhat";
async function main() {
  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

  const UNSTAKE_DELAY_SEC = 100;
  const PAYMASTER_STAKE = ethers.utils.parseEther("1");

  const SmartWallet = await ethers.getContractFactory("SmartWallet");
  const baseImpl = await SmartWallet.deploy();
  await baseImpl.deployed();
  console.log("base wallet impl deployed at: ", baseImpl.address);

  const WalletFactory = await ethers.getContractFactory("WalletFactory");
  const walletFactory = await WalletFactory.deploy(baseImpl.address);
  await walletFactory.deployed();
  console.log("wallet factory deployed at: ", walletFactory.address);

  const expected = await walletFactory.getAddressForCounterfactualWallet(
    owner,
    0
  );
  console.log("deploying new wallet..expected address: ", expected);

  const EntryPoint = await ethers.getContractFactory("EntryPoint");
  const entryPoint = await EntryPoint.deploy(
    PAYMASTER_STAKE,
    UNSTAKE_DELAY_SEC
  );
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
