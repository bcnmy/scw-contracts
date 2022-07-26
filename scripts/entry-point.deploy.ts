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

const options = { gasLimit: 7000000 };

async function main() {
  const provider = ethers.provider;

  const UNSTAKE_DELAY_SEC = 100;
  const PAYMASTER_STAKE = ethers.utils.parseEther("1");
  const SingletonFactory = await ethers.getContractFactory("SingletonFactory");
  const EIP2470_FACTORY_ADDRESS = "0xce0042B868300000d44A59004Da54A005ffdcf9f";
  const singletonFactory = await SingletonFactory.attach(FACTORY_ADDRESS);

  const isFactoryDeployed = await isContract(FACTORY_ADDRESS, provider);
  if (!isFactoryDeployed) {
    const deployedFactory = await deployFactory(provider.getSigner());
  }

  const EntryPoint = await ethers.getContractFactory("EntryPoint");
  const entryPointBytecode = `${EntryPoint.bytecode}${encodeParam(
    "address",
    EIP2470_FACTORY_ADDRESS
  ).slice(2)}${encodeParam("uint", PAYMASTER_STAKE).slice(2)}${encodeParam(
    "uint32",
    UNSTAKE_DELAY_SEC
  ).slice(2)}`;
  const entryPointComputedAddr = buildCreate2Address(SALT, entryPointBytecode);
  console.log("Entry Point Computed Address: ", entryPointComputedAddr);

  const isEntryPointDeployed = await isContract(
    entryPointComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!isEntryPointDeployed) {
    const entryPointTxDetail: any = await (
      await singletonFactory.deploy(entryPointBytecode, SALT, options)
    ).wait();

    const entryPointDeployedAddr =
      entryPointTxDetail.events[0].args.addr.toLowerCase();
    console.log("entryPointDeployedAddr ", entryPointDeployedAddr);
    const entryPointDeploymentStatus =
      entryPointComputedAddr === entryPointDeployedAddr
        ? "Deployed Successfully"
        : false;

    console.log("entryPointDeploymentStatus ", entryPointDeploymentStatus);

    if (!entryPointDeploymentStatus) {
      console.log("Invalid Entry Point Deployment");
    }
  } else {
    console.log(
      "Entry Point is Already deployed with address ",
      entryPointComputedAddr
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
