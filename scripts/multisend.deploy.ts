import { ethers } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  getDeployerInstance,
  isContract,
} from "./utils";

const options = { gasLimit: 7000000 };

async function main() {
  const provider = ethers.provider;

  const deployerInstance = await getDeployerInstance();
  const MULTI_SEND_SALT = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.MULTI_SEND)
  );

  const multiSend = await ethers.getContractFactory("MultiSend");
  const multiSendBytecode = `${multiSend.bytecode}`;
  const multiSendComputedAddr = await deployerInstance.addressOf(
    MULTI_SEND_SALT
  );

  console.log("multiSend Computed Address: ", multiSendComputedAddr);

  const ismultiSendDeployed = await isContract(multiSendComputedAddr, provider); // true (deployed on-chain)
  if (!ismultiSendDeployed) {
    await deployContract(
      DEPLOYMENT_SALTS.MULTI_SEND,
      multiSendComputedAddr,
      MULTI_SEND_SALT,
      multiSendBytecode,
      deployerInstance
    );
  } else {
    console.log(
      "multiSend is Already deployed with address ",
      multiSendComputedAddr
    );
  }

  const MULTI_SEND_CALLONLY_SALT = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.MULTI_SEND_CALLONLY)
  );

  const multiSendCallOnly = await ethers.getContractFactory(
    "MultiSendCallOnly"
  );
  const multiSendCallOnlyBytecode = `${multiSendCallOnly.bytecode}`;
  const multiSendCallOnlyComputedAddr = await deployerInstance.addressOf(
    MULTI_SEND_CALLONLY_SALT
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
    await deployContract(
      DEPLOYMENT_SALTS.MULTI_SEND_CALLONLY,
      multiSendCallOnlyComputedAddr,
      MULTI_SEND_CALLONLY_SALT,
      multiSendCallOnlyBytecode,
      deployerInstance
    );
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
