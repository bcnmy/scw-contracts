import hre, { ethers } from "hardhat";
async function main() {
  const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

  const VerifyingPaymaster = await ethers.getContractFactory(
    "VerifyingPaymaster"
  );
  const payMasterImp = await VerifyingPaymaster.deploy();
  await payMasterImp.deployed();
  console.log("paymaster Implementation deployed at: ", payMasterImp.address);

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
  // Making test Deployment
  const ownerAddress = '0x2b241cBe6B455e08Ade78a7ccC42DE2403d7b566'
  const verifySignerAddress = '0x2b241cBe6B455e08Ade78a7ccC42DE2403d7b566'
  const entryPointAddress = '0x2167fA17BA3c80Adee05D98F0B55b666Be6829d6'
  await verifyingPayMasterFactory.deployVerifyingPaymaster(ownerAddress, verifySignerAddress, entryPointAddress)

  await delay(4000);

  // verifying pay master Implementation

  try{
    await hre.run("verify:verify", {
        contract:
          "contracts/smart-contract-wallet/paymasters/VerifyingPaymaster.sol:VerifyingPaymaster",
        address: payMasterImp.address,
        constructorArguments: [],
      });
  }catch(err){
      console.log('error while verifying paymaster contract')
      console.log(err);
      
  }
  
  try{
      // verifying pay master factory Implementation
  await hre.run("verify:verify", {
    contract:
      "contracts/smart-contract-wallet/paymasters/VerifyingPaymasterFactory.sol:VerifyingPaymasterFactory",
    address: verifyingPayMasterFactory.address,
    constructorArguments: [payMasterImp.address],
  });
  }catch(err){
    console.log('error while verifying factory contract')
    console.log(err);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
