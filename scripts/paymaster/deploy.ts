import hre, { ethers } from "hardhat";
async function main() {
  const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

  const VerifyingPaymaster = await ethers.getContractFactory(
    "VerifyingPaymaster"
  );
  const payMasterImp = await VerifyingPaymaster.deploy();
  await payMasterImp.deployed();
  console.log("paymaster Implementation deployed at: ", payMasterImp.address);
  // await delay(4000);

  const VerifyingPayMasterFactory = await ethers.getContractFactory(
    "VerifyingPaymasterFactory"
  );
  const verifyingPayMasterFactory = await VerifyingPayMasterFactory.deploy(
    payMasterImp.address
  );
  await verifyingPayMasterFactory.deployed();
  console.log(
    "verifyingPaymasterFactory deployed at: ",
    verifyingPayMasterFactory.address
  );

  await delay(4000);

  // verifying pay master Implementation

  await hre.run("verify:verify", {
    contract:
      "contracts/smart-contract-wallet/paymasters/verifying/VerifyingPaymaster.sol:VerifyingPaymaster",
    address: payMasterImp.address,
    constructorArguments: [],
  });
  
  // verifying pay master factory Implementation
  await hre.run("verify:verify", {
    contract:
      "contracts/smart-contract-wallet/paymasters/verifying/VerifyingPaymasterFactory.sol:VerifyingPaymasterFactory",
    address: verifyingPayMasterFactory.address,
    constructorArguments: [payMasterImp.address],
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
