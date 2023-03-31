import { ethers, run, network } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  encodeParam,
  getDeployerInstance,
  isContract,
} from "./utils";
import { Deployer, Deployer__factory } from "../typechain";

const provider = ethers.provider;
let baseImpAddress = "0xA582A3c342A8A221Dada8Ead8d0ef96c4B57A09c";
let entryPointAddress = process.env.ENTRY_POINT_ADDRESS || "0x0576a174D229E3cFA37253523E645A78A0C91B57";
const owner = process.env.PAYMASTER_OWNER_ADDRESS_DEV || "";
const verifyingSigner = process.env.PAYMASTER_SIGNER_ADDRESS_DEV || "";
const DEPLOYER_CONTRACT_ADDRESS = process.env.DEPLOYER_CONTRACT_ADDRESS_DEV || "";


async function verifyWalletFactoryContract(factoryAddress: any) {
  try {
    const WalletFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );

    const walletFactoryBytecode = `${WalletFactory.bytecode}${encodeParam(
      "address",
      baseImpAddress
    ).slice(2)}`;

    const walletFactoryComputedAddr = factoryAddress;

    console.log("Wallet Factory at Address: ", walletFactoryComputedAddr);

    const iswalletFactoryDeployed = await isContract(
      walletFactoryComputedAddr,
      provider
    ); // true (deployed on-chain)
    
    if (iswalletFactoryDeployed) {
      await run(`verify:verify`, {
        address: walletFactoryComputedAddr,
        constructorArguments: [baseImpAddress],
      });
    }

  } catch (err) {
    console.log(err);
  }
}



async function main() {

  await verifyWalletFactoryContract("0x388A13c23995F90a015cc8513d132bff16aaDb55");
  
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
