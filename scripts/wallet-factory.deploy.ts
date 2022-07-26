import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
  SALT,
  FACTORY_ADDRESS,
  factoryAbi,
  FACTORY_BYTE_CODE,
  buildCreate2Address,
  encodeParam,
  isContract,
} from "./utils";

const factoryDeployer = "0x2cf491602ad22944D9047282aBC00D3e52F56B37";
const factoryDeployerKey: string =
  process.env.CREATE2_FACTORY_DEPLOYER_PRIVATE_KEY || "";
const factoryDeploymentFee = (0.0247 * 1e18).toString(); // 0.0247

const options = { gasLimit: 7000000, gasPrice: 70000000000 };

async function main() {
  const provider = ethers.provider;

  const SingletonFactory = await ethers.getContractFactory("SingletonFactory");
  const singletonFactory = SingletonFactory.attach(FACTORY_ADDRESS);

  const isFactoryDeployed = await isContract(FACTORY_ADDRESS, provider);
  if (!isFactoryDeployed) {
    const deployedFactory = await deployFactory(provider.getSigner());
  }

  const SmartWallet = await ethers.getContractFactory("SmartWallet");
  const smartWalletBytecode = `${SmartWallet.bytecode}`;
  const baseImpComputedAddr = buildCreate2Address(SALT, smartWalletBytecode);
  console.log("Base wallet Computed Address: ", baseImpComputedAddr);

  let baseImpDeployedAddr;
  const isBaseImpDeployed = await isContract(baseImpComputedAddr, provider); // true (deployed on-chain)
  if (!isBaseImpDeployed) {
    const baseImpTxDetail: any = await (
      await singletonFactory.deploy(smartWalletBytecode, SALT, options)
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
      await singletonFactory.deploy(walletFactoryBytecode, SALT, options)
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

async function deployFactory(signer: Signer) {
  /* if (await this._isFactoryDeployed()) {
    return
  } */
  if (
    (await ethers.provider.getBalance(factoryDeployer)).lte(
      ethers.constants.Zero
    )
  ) {
    const tx = await signer?.sendTransaction({
      to: factoryDeployer,
      value: ethers.BigNumber.from(factoryDeploymentFee),
    });
    await tx.wait(1);
  }

  const provider = ethers.provider;
  const deployer = new ethers.Wallet(factoryDeployerKey, provider);
  const Factory = new ethers.ContractFactory(
    factoryAbi,
    FACTORY_BYTE_CODE,
    deployer
  );
  // const options = { gasLimit: 7000000, gasPrice: 70000000000 };
  // const options = { gasPrice: 50000000000 };
  const factory = await Factory.deploy();
  await factory.deployTransaction.wait(2);
  console.log("Universal Deployer is now deployed at: ", factory.address);
  return factory.address;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
