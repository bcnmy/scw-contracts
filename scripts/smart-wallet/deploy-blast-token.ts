import { sign } from "crypto";
import { ethers, run } from "hardhat";
async function main() {
  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
  const entryPointAddress =
    process.env.ENTRY_POINT_ADDRESS ||
    "0x0576a174D229E3cFA37253523E645A78A0C91B57";

  const [signer] = await ethers.getSigners();
  console.log("Signer address: ", signer.address);

  const MockToken = await ethers.getContractFactory("BlastToken1");
  const mockToken = await MockToken.deploy();
  await mockToken.deployed();
  console.log("Mock token deployed at: ", mockToken.address);

  await run("verify:verify", {
    address: mockToken.address,
    constructorArguments: [],
  });

  await signer.sendTransaction({
    value: ethers.utils.parseEther("0.2"),
    to: mockToken.address,
    data: "0x",
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
