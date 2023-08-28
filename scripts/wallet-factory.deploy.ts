import { ethers } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  encodeParam,
  getDeployerInstance,
  isContract,
} from "./utils";

// should come from env
const entryPointAddress =
  process.env.ENTRY_POINT_ADDRESS ||
  "0x0576a174D229E3cFA37253523E645A78A0C91B57";

async function main() {
  const provider = ethers.provider;

  const deployerInstance = await getDeployerInstance();
  const WALLET_FACTORY_IMP_SALT = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.WALLET_IMP)
  );

  const SmartWallet = await ethers.getContractFactory("SmartAccount");
  const smartWalletBytecode = `${SmartWallet.bytecode}${encodeParam(
    "address",
    entryPointAddress
  ).slice(2)}`;
  const baseImpComputedAddr = await deployerInstance.addressOf(
    WALLET_FACTORY_IMP_SALT
  );
  console.log("Base wallet Computed Address: ", baseImpComputedAddr);

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

  const walletFactoryBytecode = `${WalletFactory.bytecode}`;

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
