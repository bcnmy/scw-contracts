import hre, { ethers } from "hardhat";

async function main() {
  const provider = ethers.provider;
  const from = await provider.getSigner().getAddress();

  const ret = await hre.deployments.deploy("MultichainBTCValidator", {
    from,
    deterministicDeployment: true,
  });

  console.log("MultichainBTCValidator Address", ret.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
