import hre, { deployments, ethers } from "hardhat";
import { Wallet, Contract, BytesLike } from "ethers";
import {
  AddressResolver__factory,
  EntryPoint__factory,
} from "../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import solc from "solc";

export const getEntryPoint = async () => {
  const EntryPointDeployment = await deployments.get("EntryPoint");
  return EntryPoint__factory.connect(
    EntryPointDeployment.address,
    ethers.provider.getSigner()
  );
};

export const getAddressResolver = async () => {
  const AddressResolverDeployment = await deployments.get("AddressResolver");
  return AddressResolver__factory.connect(
    AddressResolverDeployment.address,
    ethers.provider.getSigner()
  );
};

export const getSmartAccountImplementation = async () => {
  const SmartAccountImplDeployment = await deployments.get("SmartAccount");
  const SmartAccountImpl = await hre.ethers.getContractFactory("SmartAccount");
  return SmartAccountImpl.attach(SmartAccountImplDeployment.address);
};

export const getSmartAccountImplementationV1 = async () => {
  const SmartAccountImplDeployment = await deployments.get("SmartAccountV1");
  const SmartAccountImpl = await hre.ethers.getContractFactory(
    "SmartAccountV1"
  );
  return SmartAccountImpl.attach(SmartAccountImplDeployment.address);
};

export const getSmartAccountFactory = async () => {
  const SAFactoryDeployment = await deployments.get("SmartAccountFactory");
  const SmartAccountFactory = await hre.ethers.getContractFactory(
    "SmartAccountFactory"
  );
  const smartAccountFactory = SmartAccountFactory.attach(
    SAFactoryDeployment.address
  );
  return smartAccountFactory;
};

export const getSmartAccountFactoryV1 = async () => {
  const SAFactoryDeployment = await deployments.get("SmartAccountFactoryV1");
  const SmartAccountFactory = await hre.ethers.getContractFactory(
    "SmartAccountFactoryV1"
  );
  const smartAccountFactory = SmartAccountFactory.attach(
    SAFactoryDeployment.address
  );
  return smartAccountFactory;
};

export const getStakedSmartAccountFactory = async () => {
  const SAFactoryDeployment = await deployments.get("SmartAccountFactory");
  const SmartAccountFactory = await hre.ethers.getContractFactory(
    "SmartAccountFactory"
  );
  const smartAccountFactory = SmartAccountFactory.attach(
    SAFactoryDeployment.address
  );
  const entryPoint = await getEntryPoint();
  const unstakeDelay = 600;
  const stakeValue = ethers.utils.parseEther("10");
  await smartAccountFactory.addStake(entryPoint.address, unstakeDelay, {
    value: stakeValue,
  });
  return smartAccountFactory;
};

export const getMockToken = async () => {
  const MockTokenDeployment = await deployments.get("MockToken");
  const MockToken = await hre.ethers.getContractFactory("MockToken");
  return MockToken.attach(MockTokenDeployment.address);
};

export const getEcdsaOwnershipRegistryModule = async () => {
  const EcdsaOwnershipRegistryModuleDeployment = await deployments.get(
    "EcdsaOwnershipRegistryModule"
  );
  const EcdsaOwnershipRegistryModule = await hre.ethers.getContractFactory(
    "EcdsaOwnershipRegistryModule"
  );
  return EcdsaOwnershipRegistryModule.attach(
    EcdsaOwnershipRegistryModuleDeployment.address
  );
};

export const getMultiChainModule = async () => {
  const MultiChainValidatorDeployment = await deployments.get(
    "MultichainECDSAValidator"
  );
  const MultiChainValidator = await hre.ethers.getContractFactory(
    "MultichainECDSAValidator"
  );
  return MultiChainValidator.attach(MultiChainValidatorDeployment.address);
};

export const getSmartContractOwnershipRegistryModule = async () => {
  const SmartContractOwnerhsipRegistryDeployment = await deployments.get(
    "SmartContractOwnershipRegistryModule"
  );
  const SmartContractOwnerhsipRegistryModule =
    await hre.ethers.getContractFactory("SmartContractOwnershipRegistryModule");
  return SmartContractOwnerhsipRegistryModule.attach(
    SmartContractOwnerhsipRegistryDeployment.address
  );
};

export const getSmartAccountWithModule = async (
  moduleSetupContract: string,
  moduleSetupData: BytesLike,
  index: number
) => {
  const factory = await getSmartAccountFactory();
  const expectedSmartAccountAddress =
    await factory.getAddressForCounterFactualAccount(
      moduleSetupContract,
      moduleSetupData,
      index
    );
  await factory.deployCounterFactualAccount(
    moduleSetupContract,
    moduleSetupData,
    index
  );
  return await hre.ethers.getContractAt(
    "SmartAccount",
    expectedSmartAccountAddress
  );
};

export const compile = async (
  source: string,
  settingsOverrides?: { evmVersion?: string }
) => {
  const input = JSON.stringify({
    language: "Solidity",
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
      ...settingsOverrides,
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
  deployer: Wallet | SignerWithAddress,
  source: string,
  settingsOverrides?: { evmVersion?: string }
): Promise<Contract> => {
  const output = await compile(source, settingsOverrides);
  const transaction = await deployer.sendTransaction({
    data: output.data,
    gasLimit: 6000000,
  });
  const receipt = await transaction.wait();
  return new Contract(receipt.contractAddress, output.interface, deployer);
};
