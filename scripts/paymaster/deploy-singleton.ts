import hre, { ethers } from "hardhat";
async function main() {
  let tx, receipt;
  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
  const verifyingSigner = "0x416B03E2E5476B6a2d1dfa627B404Da1781e210d";
  const entryPoint = "0xFF95ad8beD219969f608FfF36db647318F4bb4C0";

  const VerifyingSingletonPaymaster = await ethers.getContractFactory(
    "VerifyingSingletonPaymaster"
  );
  const singletonPaymster = await VerifyingSingletonPaymaster.deploy(
    entryPoint,
    verifyingSigner
  );
  await singletonPaymster.deployed();
  console.log("singletonPaymster deployed at: ", singletonPaymster.address);

  tx = await singletonPaymster.transferOwnership(owner);
  receipt = await tx.wait(1);
  console.log(
    `Singleton verifying paymaster ownership transferred to ${owner}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
