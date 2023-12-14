import { ethers } from "hardhat";
async function main() {
  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";

  const TrustedForwarder = await ethers.getContractFactory(
    "BiconomyForwarderV2"
  );
  const trustedForwarder = await TrustedForwarder.deploy();
  await trustedForwarder.deployed();
  console.log("trustedForwarder deployed at: ", trustedForwarder.address);

  // Set domain separator

  const tx = await trustedForwarder.registerDomainSeparator(
    "Powered by Biconomy",
    "1"
  );

  const receipt = await tx.wait();
  console.log(
    "gas used to register domain separator",
    receipt.gasUsed.toNumber()
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
