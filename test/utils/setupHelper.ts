import hre from "hardhat";
import { Wallet, Contract } from "ethers";
import { AddressZero } from "@ethersproject/constants";
const solc = require("solc");

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
