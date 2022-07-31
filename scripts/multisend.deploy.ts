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

  const multiSend = await ethers.getContractFactory("MultiSend");
  const multiSendBytecode = `${multiSend.bytecode}`;
  const multiSendComputedAddr = buildCreate2Address(SALT, multiSendBytecode);
  console.log("multiSend Computed Address: ", multiSendComputedAddr);

  const ismultiSendDeployed = await isContract(multiSendComputedAddr, provider); // true (deployed on-chain)
  if (!ismultiSendDeployed) {
    const multiSendTxDetail: any = await (
      await singletonFactory.deploy(multiSendBytecode, SALT, options)
    ).wait();

    const multiSendDeployedAddr =
      multiSendTxDetail.events[0].args.addr.toLowerCase();
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
  const multiSendCallOnlyComputedAddr = buildCreate2Address(
    SALT,
    multiSendCallOnlyBytecode
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
    const multiSendCallOnlyTxDetail: any = await (
      await singletonFactory.deploy(multiSendCallOnlyBytecode, SALT, options)
    ).wait();

    const multiSendCallOnlyDeployedAddr =
      multiSendCallOnlyTxDetail.events[0].args.addr.toLowerCase();
    console.log("multiSendCallOnlyDeployedAddr ", multiSendCallOnlyDeployedAddr);
    const multiSendCallOnlyDeploymentStatus =
      multiSendComputedAddr === multiSendCallOnlyDeployedAddr
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
