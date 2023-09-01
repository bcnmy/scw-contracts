import { ethers } from "hardhat";
async function main() {
  const entryPointAddress = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

  const SmartAccount = await ethers.getContractFactory("SmartAccount");
  const smartAccount = await SmartAccount.deploy(entryPointAddress, {
    maxFeePerGas: 3e9,
    maxPriorityFeePerGas: 2e9,
  });
  await smartAccount.deployed();
  console.log("Implementation deployed at: ", smartAccount.address);
  /*
  await run(`verify:verify`, {
    address: smartAccount.address,
    constructorArguments: [entryPointAddress],
  });
  */

  const SmartAccountFactory = await ethers.getContractFactory(
    "SmartAccountFactory"
  );
  const smartAccountFactory = await SmartAccountFactory.deploy(
    smartAccount.address
  );
  await smartAccountFactory.deployed();
  console.log("Factory deployed at: ", smartAccountFactory.address);
  /*
  await run(`verify:verify`, { 
    address: smartAccountFactory.address,
    constructorArguments: [smartAccount.address],
  });
*/

  const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
    "EcdsaOwnershipRegistryModule"
  );
  const ecdsaOwnershipRegistryModule =
    await EcdsaOwnershipRegistryModule.deploy();
  await ecdsaOwnershipRegistryModule.deployed();
  console.log(
    "EcdsaOwnershipRegistryModule deployed at: ",
    ecdsaOwnershipRegistryModule.address
  );

  /*
  await run(`verify:verify`, {
    address: ecdsaOwnershipRegistryModule.address,
  });
  */

  /*
  const PasskeyModule = await ethers.getContractFactory("PasskeyRegistryModule");
  const passkeyModule = await PasskeyModule.deploy();
  await passkeyModule.deployed();
  console.log("passkeyModule deployed at: ", passkeyModule.address);
  */
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
