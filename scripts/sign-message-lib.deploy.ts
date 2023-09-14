import { ethers } from "hardhat";
async function main() {
  const SignMessageLib = await ethers.getContractFactory("SignMessageLib");
  const messageLib = await SignMessageLib.deploy();
  await messageLib.deployed();
  console.log("sign message lib deployed at: ", messageLib.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
