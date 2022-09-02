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

  const decoder = await ethers.getContractFactory("Decoder");
  const decoderBytecode = `${decoder.bytecode}`;
  const decoderComputedAddr = getDeployedAddress(
    decoderBytecode,
    ethers.BigNumber.from(SALT)
  );
  console.log("decoder Computed Address: ", decoderComputedAddr);

  const isdecoderDeployed = await isContract(
    decoderComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!isdecoderDeployed) {
    const decoderDeployedAddr = await deploy(
      provider,
      decoderBytecode,
      ethers.BigNumber.from(SALT)
    );
    console.log("decoderDeployedAddr ", decoderDeployedAddr);
    const decoderDeploymentStatus =
      decoderComputedAddr === decoderDeployedAddr
        ? "Deployed Successfully"
        : false;

    console.log("decoderDeploymentStatus ", decoderDeploymentStatus);

    if (!decoderDeploymentStatus) {
      console.log("Invalid decoder Deployment");
    }
  } else {
    console.log(
      "decoder is Already deployed with address ",
      decoderComputedAddr
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
