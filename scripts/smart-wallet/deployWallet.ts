// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre, { ethers } from "hardhat";

// const provider = ethers.provider;
// const ethersSigner = provider.getSigner();

async function main() {
  const delay = (ms: number) => new Promise((res) => setTimeout(res, ms))
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // Gasless deployment
  // Add your owner - could be any
  // const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

  // const UNSTAKE_DELAY_SEC = 100;
  // const PAYMASTER_STAKE = ethers.utils.parseEther("1");

  // const SmartWallet = await ethers.getContractFactory("SmartWallet");
  // const baseImpl = await SmartWallet.deploy();
  // await baseImpl.deployed();
  // console.log("base wallet impl deployed at: ", baseImpl.address);

  // const WalletFactory = await ethers.getContractFactory("WalletFactory");
  // const walletFactory = await WalletFactory.deploy(baseImpl.address);
  // await walletFactory.deployed();
  // console.log("wallet factory deployed at: ", walletFactory.address);

  // const expected = await walletFactory.getAddressForCounterfactualWallet(
  //   owner,
  //   0
  // );
  // console.log("deploying new wallet..expected address: ", expected);

  // const EntryPoint = await ethers.getContractFactory("EntryPoint");
  // const entryPoint = await EntryPoint.deploy(
  //   PAYMASTER_STAKE,
  //   UNSTAKE_DELAY_SEC
  // );
  // await entryPoint.deployed();
  // console.log("Entry point deployed at: ", entryPoint.address);

  // const DefaultHandler = await ethers.getContractFactory(
  //   "DefaultCallbackHandler"
  // );
  // const handler = await DefaultHandler.deploy();
  // await handler.deployed();
  // console.log("Default callback handler deployed at: ", handler.address);


  const VerifyingPaymaster = await ethers.getContractFactory(
    "VerifyingPayMaster"
  );
  const payMasterImp = await VerifyingPaymaster.deploy();
  await payMasterImp.deployed();
  console.log("payMaster Implementation deployed at: ", payMasterImp.address);
  // await delay(25000)

  // await hre.run("verify:verify", {
  //   contract: "contracts/references/aa-4337/VerifyingPayMaster.sol:VerifyingPayMaster",
  //   address: payMasterImp.address,
  //   constructorArguments: [],
  // })


  const VerifyingPayMasterFactory = await ethers.getContractFactory(
    "VerifyingPayMasterFactory"
  );
  const verifyingPayMasterFactory = await VerifyingPayMasterFactory.deploy(payMasterImp.address);
  await verifyingPayMasterFactory.deployed();
  console.log("verifyingPayMasterFactory Implementation deployed at: ", verifyingPayMasterFactory.address);
  
  await verifyingPayMasterFactory.deployVerifyingPayMaster('0xD68fdc0B89010a9039C2C38f4a3E5c4Ed98f7bC1', '0xD68fdc0B89010a9039C2C38f4a3E5c4Ed98f7bC1', '0x2167fA17BA3c80Adee05D98F0B55b666Be6829d6')
  await delay(25000)

  await hre.run("verify:verify", {
    contract: "contracts/smart-contract-wallet/VerifyingPayMasterFactory.sol:VerifyingPayMasterFactory",
    address: verifyingPayMasterFactory.address,
    constructorArguments: [payMasterImp.address],
  })

  // TODO
  // how can write tx return address to var
  // const proxy = await walletFactory.deployCounterFactualWallet(
  //   owner,
  //   entryPoint.address,
  //   handler.address,
  //   0
  // );

  // this will give tx object instead of proxy
  // console.log("proxy deplayed at:  ? ", proxy);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
