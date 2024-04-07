import hre, { ethers } from "hardhat";

async function main() {
  const provider = ethers.provider;
  const from = await provider.getSigner().getAddress();

  const ret = await hre.deployments.deploy("SmartAccountFactory", {
    from,
    args: ['0x87a06cbbe0116a50e93D023896b8C9DB20EcC7a1', '0xda9f010412EB1D9A06A19b6E6C2ffB5866E712bC'],
    deterministicDeployment: true,
  });

  console.log("SmartAccountFactory Address", ret.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
