// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";

// const provider = ethers.provider;
// const ethersSigner = provider.getSigner();

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // Gasless deployment
  // Add your owner - could be any

  const Create2Factory = await ethers.getContractFactory("SingletonFactory");
  // Before deploying must connect with fresh deployer which has nonce 0 unused on all chains!
  const create2Factory = await Create2Factory.deploy();
  await create2Factory.deployed();
  console.log("Create2 factory deployed at: ", create2Factory.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
