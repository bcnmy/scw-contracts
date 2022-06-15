import { ethers } from "hardhat";
import {
  SALT,
  FACTORY_ADDRESS,
  buildCreate2Address,
  encodeParam,
  isContract,
} from "./utils";

async function main() {
  const provider = ethers.provider;

  const SingletonFactory = await ethers.getContractFactory("SingletonFactory");
  const singletonFactory = SingletonFactory.attach(FACTORY_ADDRESS);

  const SmartWallet = await ethers.getContractFactory("SmartWallet");
  const smartWalletBytecode = `${SmartWallet.bytecode}`;
  const baseImpComputedAddr = buildCreate2Address(SALT, smartWalletBytecode);
  console.log("Base wallet Computed Address: ", baseImpComputedAddr);

  let baseImpDeployedAddr;
  const isBaseImpDeployed = await isContract(baseImpComputedAddr, provider); // true (deployed on-chain)
  if (!isBaseImpDeployed) {
    const baseImpTxDetail: any = await (
      await singletonFactory.deploy(smartWalletBytecode, SALT)
    ).wait();

    baseImpDeployedAddr = baseImpTxDetail.events[0].args.addr.toLowerCase();
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
  const WalletFactory = await ethers.getContractFactory("WalletFactory");

  const walletFactoryBytecode = `${WalletFactory.bytecode}${encodeParam(
    "address",
    baseImpDeployedAddr
  ).slice(2)}`;

  const walletFactoryComputedAddr = buildCreate2Address(
    SALT,
    walletFactoryBytecode
  );

  console.log("Wallet Factory Computed Address: ", walletFactoryComputedAddr);

  const iswalletFactoryDeployed = await isContract(
    walletFactoryComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!iswalletFactoryDeployed) {
    const walletFactoryTxDetail: any = await (
      await singletonFactory.deploy(walletFactoryBytecode, SALT)
    ).wait();

    const walletFactoryDeployedAddr =
      walletFactoryTxDetail.events[0].args.addr.toLowerCase();
    console.log("walletFactoryDeployedAddr ", walletFactoryDeployedAddr);

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
