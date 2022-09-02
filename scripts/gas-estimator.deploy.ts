import { ethers } from "hardhat";
import {
  SALT,
  FACTORY_ADDRESS,
  getDeployedAddress,
  deploy,
  deployFactory,
  encodeParam,
  isContract,
} from "./utils";

const options = { gasLimit: 7000000, gasPrice: 70000000000 };

async function main() {
  const provider = ethers.provider;

  // const singletonFactory = await SingletonFactory.attach(FACTORY_ADDRESS);

  const isFactoryDeployed = await isContract(FACTORY_ADDRESS, provider);
  if (!isFactoryDeployed) {
    const deployedFactory = await deployFactory(provider);
  }

  const gasEstimator = await ethers.getContractFactory("GasEstimator");
  const gasEstimatorBytecode = `${gasEstimator.bytecode}`;
  const gasEstimatorComputedAddr = getDeployedAddress(
    gasEstimatorBytecode,
    ethers.BigNumber.from(SALT)
  );
  console.log("gasEstimator Computed Address: ", gasEstimatorComputedAddr);

  const isgasEstimatorDeployed = await isContract(
    gasEstimatorComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!isgasEstimatorDeployed) {
    const gasEstimatorDeployedAddr = await deploy(
      provider,
      gasEstimatorBytecode,
      ethers.BigNumber.from(SALT)
    );
    console.log("gasEstimatorDeployedAddr ", gasEstimatorDeployedAddr);
    const gasEstimatorDeploymentStatus =
      gasEstimatorComputedAddr === gasEstimatorDeployedAddr
        ? "Deployed Successfully"
        : false;

    console.log("gasEstimatorDeploymentStatus ", gasEstimatorDeploymentStatus);

    if (!gasEstimatorDeploymentStatus) {
      console.log("Invalid GasEstimator Deployment");
    }
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
