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

  // const SingletonFactory = await ethers.getContractFactory("SingletonFactory");
  // const singletonFactory = SingletonFactory.attach(FACTORY_ADDRESS);

  const isFactoryDeployed = await isContract(FACTORY_ADDRESS, provider);
  if (!isFactoryDeployed) {
    const deployedFactory = await deployFactory(provider);
  }

  const SmartWallet = await ethers.getContractFactory("SmartAccount");
  const smartWalletBytecode = `${SmartWallet.bytecode}`;
  const baseImpComputedAddr = getDeployedAddress(
    smartWalletBytecode,
    ethers.BigNumber.from(SALT)
  );
  console.log("Base wallet Computed Address: ", baseImpComputedAddr);

  let baseImpDeployedAddr;
  const isBaseImpDeployed = await isContract(baseImpComputedAddr, provider); // true (deployed on-chain)
  if (!isBaseImpDeployed) {
    baseImpDeployedAddr = await deploy(
      provider,
      smartWalletBytecode,
      ethers.BigNumber.from(SALT)
    );

    console.log("baseImpDeployedAddr ", baseImpDeployedAddr);
    const baseImpDeploymentStatus =
      baseImpComputedAddr === baseImpDeployedAddr
        ? "Deployed Successfully"
        : false;

    console.log("baseImpDeploymentStatus ", baseImpDeploymentStatus);

    if (!baseImpDeploymentStatus) {
      console.log("Invalid Base Imp Deployment");
      return;
    }
  } else {
    console.log(
      "Base Imp is already deployed with address ",
      baseImpComputedAddr
    );
    baseImpDeployedAddr = baseImpComputedAddr;
  }
  const WalletFactory = await ethers.getContractFactory("SmartAccountFactory");

  const walletFactoryBytecode = `${WalletFactory.bytecode}${encodeParam(
    "address",
    baseImpDeployedAddr
  ).slice(2)}`;

  const walletFactoryComputedAddr = getDeployedAddress(
    walletFactoryBytecode,
    ethers.BigNumber.from(SALT)
  );

  console.log("Wallet Factory Computed Address: ", walletFactoryComputedAddr);

  const iswalletFactoryDeployed = await isContract(
    walletFactoryComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!iswalletFactoryDeployed) {
    const walletFactoryDeployedAddr = await deploy(
      provider,
      walletFactoryBytecode,
      ethers.BigNumber.from(SALT)
    );

    const walletFactoryDeploymentStatus =
      walletFactoryComputedAddr === walletFactoryDeployedAddr
        ? "Wallet Factory Deployed Successfully"
        : false;
    console.log(
      "walletFactoryDeploymentStatus ",
      walletFactoryDeploymentStatus
    );

    if (!walletFactoryDeploymentStatus) {
      console.log("Invalid Wallet Factory Deployment");
    }
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
