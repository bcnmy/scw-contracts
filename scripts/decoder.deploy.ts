import { ethers } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  getDeployerInstance,
  isContract,
} from "./utils";

const options = { gasLimit: 7000000, gasPrice: 70000000000 };

async function main() {
  const provider = ethers.provider;

  const deployerInstance = await getDeployerInstance(provider);
  const salt = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.DECODER)
  );

  const decoder = await ethers.getContractFactory("Decoder");
  const decoderBytecode = `${decoder.bytecode}`;
  const decoderComputedAddr = await deployerInstance.addressOf(salt);

  console.log("decoder Computed Address: ", decoderComputedAddr);

  const isdecoderDeployed = await isContract(decoderComputedAddr, provider); // true (deployed on-chain)
  if (!isdecoderDeployed) {
    await deployContract(
      DEPLOYMENT_SALTS.DECODER,
      decoderComputedAddr,
      salt,
      decoderBytecode,
      deployerInstance
    );
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
