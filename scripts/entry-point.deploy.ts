import { ethers } from "hardhat";
import {
  SALT,
  FACTORY_ADDRESS,
  buildCreate2Address,
  encodeParam,
  isContract,
} from './utils'

async function main() {
    const provider = ethers.provider;

    const UNSTAKE_DELAY_SEC = 100;
    const PAYMASTER_STAKE = ethers.utils.parseEther("1");
    const SingletonFactory = await ethers.getContractFactory("SingletonFactory");
    const singletonFactory = await SingletonFactory.attach(FACTORY_ADDRESS);

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    const entryPointBytecode = `${EntryPoint.bytecode}${encodeParam(
      "address",
      FACTORY_ADDRESS
    ).slice(2)}${encodeParam(
      "uint",
      PAYMASTER_STAKE
    ).slice(2)}${encodeParam(
      "uint32",
      UNSTAKE_DELAY_SEC
    ).slice(2)}`;
    const entryPointComputedAddr = buildCreate2Address(
        SALT,
        entryPointBytecode
      );
    console.log("Entry Point Computed Address: ", entryPointComputedAddr);

    const isEntryPointDeployed = await isContract(entryPointComputedAddr, provider); // true (deployed on-chain)
    if (!isEntryPointDeployed){

        const entryPointTxDetail: any = await (await singletonFactory.deploy(entryPointBytecode, SALT)).wait();

        const entryPointDeployedAddr = entryPointTxDetail.events[0].args.addr.toLowerCase();
        console.log('entryPointDeployedAddr ', entryPointDeployedAddr);
        const entryPointDeploymentStatus = entryPointComputedAddr == entryPointDeployedAddr ? "Deployed Successfully" : false;
        
        console.log("entryPointDeploymentStatus ", entryPointDeploymentStatus);
        
        if (!entryPointDeploymentStatus){
            console.log("Invalid Entry Point Deployment");
            return
        }

    }else{
        console.log('Entry Point is Already deployed with address ', entryPointComputedAddr);
    }
}


main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });