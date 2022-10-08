import hre, { ethers } from "hardhat";
async function main() {
  const SessionKeyModule = await ethers.getContractFactory("SessionKeyModule");
  const sessionKeyModule = await SessionKeyModule.deploy();
  await sessionKeyModule.deployed();
  console.log("Session module deployed at: ", sessionKeyModule.address);

  await hre.run("verify:verify", {
    contract:
      "contracts/modules/session-keys/SessionKeyModule.sol:SessionKeyModule",
    address: sessionKeyModule.address,
    constructorArguments: [],
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
