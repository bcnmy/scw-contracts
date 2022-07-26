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

  const SingletonFactory = await ethers.getContractFactory("SingletonFactory");
  const singletonFactory = await SingletonFactory.attach(FACTORY_ADDRESS);

  const callBackHandler = await ethers.getContractFactory(
    "DefaultCallbackHandler"
  );
  const callBackHandlerBytecode = `${callBackHandler.bytecode}`;
  const callBackHandlerComputedAddr = buildCreate2Address(
    SALT,
    callBackHandlerBytecode
  );
  console.log(
    "CallBack Handler Computed Address: ",
    callBackHandlerComputedAddr
  );

  const iscallBackHandlerDeployed = await isContract(
    callBackHandlerComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!iscallBackHandlerDeployed) {
    const callBackHandlerTxDetail: any = await (
      await singletonFactory.deploy(callBackHandlerBytecode, SALT, options)
    ).wait();

    const callBackHandlerDeployedAddr =
      callBackHandlerTxDetail.events[0].args.addr.toLowerCase();
    console.log("callBackHandlerDeployedAddr ", callBackHandlerDeployedAddr);
    const callBackHandlerDeploymentStatus =
      callBackHandlerComputedAddr === callBackHandlerDeployedAddr
        ? "Deployed Successfully"
        : false;

    console.log(
      "callBackHandlerDeploymentStatus ",
      callBackHandlerDeploymentStatus
    );

    if (!callBackHandlerDeploymentStatus) {
      console.log("Invalid CallBack Handler Deployment");
    }
  } else {
    console.log(
      "CallBack Handler is Already deployed with address ",
      callBackHandlerComputedAddr
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
