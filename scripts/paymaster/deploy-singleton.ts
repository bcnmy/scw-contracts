import hre, { ethers } from "hardhat";
import {
  deployContract,
  encodeParam,
  DEPLOYMENT_SALTS,
  getDeployerInstance,
  isContract,
} from "../utils";
async function main() {
  let tx, receipt;
  const provider = ethers.provider;

  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
  const verifyingSigner = "0x416B03E2E5476B6a2d1dfa627B404Da1781e210d";
  const entryPoint = "0xFF95ad8beD219969f608FfF36db647318F4bb4C0";

  const deployerInstance = await getDeployerInstance();
  const salt = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.SINGELTON_PAYMASTER)
  );

  const VerifyingSingletonPaymaster = await ethers.getContractFactory(
    "VerifyingSingletonPaymaster"
  );
  const verifyingSingletonPaymasterBytecode = `${
    VerifyingSingletonPaymaster.bytecode
  }${encodeParam("address", entryPoint).slice(2)}${encodeParam(
    "address",
    owner
  ).slice(2)}${encodeParam("address", verifyingSigner).slice(2)}`;

  const verifyingSingletonPaymasterComputedAddr =
    await deployerInstance.addressOf(salt);
  console.log(
    "verifyingSingletonPaymaster Computed Address: ",
    verifyingSingletonPaymasterComputedAddr
  );
  const isContractDeployed = await isContract(
    verifyingSingletonPaymasterComputedAddr,
    provider
  );
  if (!isContractDeployed) {
    await deployContract(
      DEPLOYMENT_SALTS.SINGELTON_PAYMASTER,
      verifyingSingletonPaymasterComputedAddr,
      salt,
      verifyingSingletonPaymasterBytecode,
      deployerInstance
    );
  } else {
    console.log(
      "verifyingSingletonPaymaster is Already deployed with address ",
      verifyingSingletonPaymasterBytecode
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
