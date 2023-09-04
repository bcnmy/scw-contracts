import { ethers } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  getDeployerInstance,
  isContract,
} from "./utils";

async function main() {
  const provider = ethers.provider;

  const deployerInstance = await getDeployerInstance();
  const salt = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.GAS_ESTIMATOR)
  );

  const gasEstimator = await ethers.getContractFactory("GasEstimator");
  const gasEstimatorBytecode = `${gasEstimator.bytecode}`;
  const gasEstimatorComputedAddr = await deployerInstance.addressOf(salt);

  console.log("gasEstimator Computed Address: ", gasEstimatorComputedAddr);

  const isgasEstimatorDeployed = await isContract(
    gasEstimatorComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!isgasEstimatorDeployed) {
    await deployContract(
      DEPLOYMENT_SALTS.GAS_ESTIMATOR,
      gasEstimatorComputedAddr,
      salt,
      gasEstimatorBytecode,
      deployerInstance
    );
  } else {
    console.log(
      "GasEstimator is Already deployed with address ",
      gasEstimatorComputedAddr
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
