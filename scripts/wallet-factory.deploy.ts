import { ethers } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  encodeParam,
  getDeployerInstance,
  isContract,
} from "./utils";

const options = { gasLimit: 7000000, gasPrice: 70000000000 };

async function main() {
  const provider = ethers.provider;

  const deployerInstance = await getDeployerInstance(provider);
  const WALLET_FACTORY_IMP_SALT = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.WALLET_IMP)
  );

  const SmartWallet = await ethers.getContractFactory("SmartAccount");
  const smartWalletBytecode = `${SmartWallet.bytecode}`;
  const baseImpComputedAddr = await deployerInstance.addressOf(
    WALLET_FACTORY_IMP_SALT
  );
  console.log("Base wallet Computed Address: ", baseImpComputedAddr);

  let baseImpDeployedAddr;
  const isBaseImpDeployed = await isContract(baseImpComputedAddr, provider); // true (deployed on-chain)
  if (!isBaseImpDeployed) {
    await deployContract(
      DEPLOYMENT_SALTS.WALLET_IMP,
      baseImpComputedAddr,
      WALLET_FACTORY_IMP_SALT,
      smartWalletBytecode,
      deployerInstance
    );
  } else {
    console.log(
      "Base Imp is already deployed with address ",
      baseImpComputedAddr
    );
  }
  const WalletFactory = await ethers.getContractFactory("SmartAccountFactory");

  const WALLET_FACTORY_SALT = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.WALLET_FACTORY)
  );

  const walletFactoryBytecode = `${WalletFactory.bytecode}${encodeParam(
    "address",
    baseImpComputedAddr
  ).slice(2)}`;

  const walletFactoryComputedAddr = await deployerInstance.addressOf(
    WALLET_FACTORY_SALT
  );

  console.log("Wallet Factory Computed Address: ", walletFactoryComputedAddr);

  const iswalletFactoryDeployed = await isContract(
    walletFactoryComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!iswalletFactoryDeployed) {
    await deployContract(
      DEPLOYMENT_SALTS.WALLET_FACTORY,
      walletFactoryComputedAddr,
      WALLET_FACTORY_SALT,
      walletFactoryBytecode,
      deployerInstance
    );
  } else {
    console.log(
      "Wallet Factory is Already Deployed with address ",
      walletFactoryComputedAddr
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
