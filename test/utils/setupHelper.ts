import hre, { deployments } from "hardhat";
import { Wallet, Contract, BytesLike } from "ethers";
import { AddressZero } from "@ethersproject/constants";
const solc = require("solc");

export const getEntryPoint = async () => {
  const EntryPointDeployment = await deployments.get("EntryPoint");
  const EntryPoint = await hre.ethers.getContractFactory("EntryPoint");
  return EntryPoint.attach(EntryPointDeployment.address);
};

export const getSmartAccountImplementation = async () => {
  const SmartAccountImplDeployment = await deployments.get("SmartAccount");
  const SmartAccountImpl = await hre.ethers.getContractFactory("SmartAccount");
  return SmartAccountImpl.attach(SmartAccountImplDeployment.address);
};

export const getSmartAccountFactory = async () => {
  const SAFactoryDeployment = await deployments.get("SmartAccountFactory");
  const SmartAccountFactory = await hre.ethers.getContractFactory("SmartAccountFactory");
  return SmartAccountFactory.attach(SAFactoryDeployment.address);
};

export const getMockToken = async () => {
  const MockTokenDeployment = await deployments.get("MockToken");
  const MockToken = await hre.ethers.getContractFactory("MockToken");
  return MockToken.attach(MockTokenDeployment.address);
};

export const getEOAOwnershipRegistryModule = async () => {
  const EOAOwnershipRegistryModuleDeployment = await deployments.get("EOAOwnershipRegistryModule");
  const EOAOwnershipRegistryModule = await hre.ethers.getContractFactory("EOAOwnershipRegistryModule");
  return EOAOwnershipRegistryModule.attach(EOAOwnershipRegistryModuleDeployment.address);
};

export const getSmartAccountWithModule = async (
  moduleSetupContract: string,
  moduleSetupData: BytesLike,
  index: number,
) => {
  const factory = await getSmartAccountFactory();
  const expectedSmartAccountAddress =
        await factory.getAddressForCounterFactualAccount(moduleSetupContract, moduleSetupData, index);
        await factory.deployCounterFactualAccount(moduleSetupContract, moduleSetupData, index);
        return await hre.ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);
}


export const compile = async (source: string) => {
  const input = JSON.stringify({
    language: "Solidity",
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
    sources: {
      "tmp.sol": {
        content: source,
      },
    },
  });
  const solcData = await solc.compile(input);
  const output = JSON.parse(solcData);
  if (!output.contracts) {
    console.log(output);
    throw Error("Could not compile contract");
  }
  const fileOutput = output.contracts["tmp.sol"];
  const contractOutput = fileOutput[Object.keys(fileOutput)[0]];
  const abi = contractOutput.abi;
  const data = "0x" + contractOutput.evm.bytecode.object;
  return {
    data: data,
    interface: abi,
  };
};

export const deployContract = async (
  deployer: Wallet,
  source: string
): Promise<Contract> => {
  const output = await compile(source);
  const transaction = await deployer.sendTransaction({
    data: output.data,
    gasLimit: 6000000,
  });
  const receipt = await transaction.wait();
  return new Contract(receipt.contractAddress, output.interface, deployer);
};
