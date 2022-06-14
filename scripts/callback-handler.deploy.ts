import { ethers } from "hardhat";
import {
  SALT,
  FACTORY_ADDRESS,
  buildCreate2Address,
  isContract,
} from './utils'

async function main() {
    const provider = ethers.provider;

    const SingletonFactory = await ethers.getContractFactory("SingletonFactory");
    const singletonFactory = await SingletonFactory.attach(FACTORY_ADDRESS);

    const callBackHandler = await ethers.getContractFactory("DefaultCallbackHandler");
    const callBackHandlerBytecode = `${callBackHandler.bytecode}`;
    const callBackHandlerComputedAddr = buildCreate2Address(
        SALT,
        callBackHandlerBytecode
      );
    console.log("CallBack Handler Computed Address: ", callBackHandlerComputedAddr);

    const iscallBackHandlerDeployed = await isContract(callBackHandlerComputedAddr, provider); // true (deployed on-chain)
    if (!iscallBackHandlerDeployed){

        const callBackHandlerTxDetail: any = await (await singletonFactory.deploy(callBackHandlerBytecode, SALT)).wait();

        const callBackHandlerDeployedAddr = callBackHandlerTxDetail.events[0].args.addr.toLowerCase();
        console.log('callBackHandlerDeployedAddr ', callBackHandlerDeployedAddr);
        const callBackHandlerDeploymentStatus = callBackHandlerComputedAddr == callBackHandlerDeployedAddr ? "Deployed Successfully" : false;
        
        console.log("callBackHandlerDeploymentStatus ", callBackHandlerDeploymentStatus);
        
        if (!callBackHandlerDeploymentStatus){
            console.log("Invalid CallBack Handler Deployment");
            return
        }

    }else{
        console.log('CallBack Handler is Already deployed with address ', callBackHandlerComputedAddr);
    }
}


main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });