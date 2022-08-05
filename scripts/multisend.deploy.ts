import { ethers } from "hardhat";
import {
  SALT,
  FACTORY_ADDRESS,
  getDeployedAddress,
  deploy,
  deployFactory,
  isContract,
} from "./utils";

const options = { gasLimit: 7000000 };

async function main() {
  const provider = ethers.provider;

  const isFactoryDeployed = await isContract(FACTORY_ADDRESS, provider);
  if (!isFactoryDeployed) {
    const deployedFactory = await deployFactory(provider);
  }

  const multiSend = await ethers.getContractFactory("MultiSend");
  const multiSendBytecode = `${multiSend.bytecode}`;
  const multiSendComputedAddr = getDeployedAddress(
    multiSendBytecode,
    ethers.BigNumber.from(SALT)
  );
  console.log("multiSend Computed Address: ", multiSendComputedAddr);

  const ismultiSendDeployed = await isContract(multiSendComputedAddr, provider); // true (deployed on-chain)
  if (!ismultiSendDeployed) {
    const multiSendDeployedAddr = await deploy(
      provider,
      multiSendBytecode,
      ethers.BigNumber.from(SALT)
    );
    console.log("multiSendDeployedAddr ", multiSendDeployedAddr);
    const multiSendDeploymentStatus =
      multiSendComputedAddr === multiSendDeployedAddr
        ? "Deployed Successfully"
        : false;

    console.log("multiSendDeploymentStatus ", multiSendDeploymentStatus);

    if (!multiSendDeploymentStatus) {
      console.log("Invalid Multisend Deployment");
    }
  } else {
    console.log(
      "multiSend is Already deployed with address ",
      multiSendComputedAddr
    );
  }

  const multiSendCallOnly = await ethers.getContractFactory(
    "MultiSendCallOnly"
  );
  const multiSendCallOnlyBytecode = `${multiSendCallOnly.bytecode}`;
  const multiSendCallOnlyComputedAddr = getDeployedAddress(
    multiSendCallOnlyBytecode,
    ethers.BigNumber.from(SALT)
  );
  console.log(
    "multiSend Callonly Computed Address: ",
    multiSendCallOnlyComputedAddr
  );

  const ismultiSendCallOnlyDeployed = await isContract(
    multiSendCallOnlyComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!ismultiSendCallOnlyDeployed) {
    const multiSendCallOnlyDeployedAddr = await deploy(
      provider,
      multiSendCallOnlyBytecode,
      ethers.BigNumber.from(SALT)
    );
    console.log(
      "multiSendCallOnlyDeployedAddr ",
      multiSendCallOnlyDeployedAddr
    );
    const multiSendCallOnlyDeploymentStatus =
      multiSendCallOnlyComputedAddr === multiSendCallOnlyDeployedAddr
        ? "Deployed Successfully"
        : false;

    console.log(
      "multiSendCallOnlyDeploymentStatus ",
      multiSendCallOnlyDeploymentStatus
    );

    if (!multiSendCallOnlyDeploymentStatus) {
      console.log("Invalid Multisend Call Only Deployment");
    }
  } else {
    console.log(
      "multiSend Call Only is Already deployed with address ",
      multiSendCallOnlyComputedAddr
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
