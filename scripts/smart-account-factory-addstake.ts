import { ethers } from "hardhat";
import { SmartAccountFactory__factory } from "../typechain";
import { factoryStakeConfig, isContract } from "./utils";
import { EntryPoint__factory } from "@account-abstraction/contracts";
import { formatEther } from "ethers/lib/utils";

const entryPointAddress =
  process.env.ENTRY_POINT_ADDRESS ||
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const smartAccountFactoryAddress = "0x9A9e92dA02485158bf4AaAA7C59398048B1cEB2D";

export async function addStake() {
  const provider = ethers.provider;
  const [signer] = await ethers.getSigners();
  const smartAccountFactory = SmartAccountFactory__factory.connect(
    smartAccountFactoryAddress,
    signer
  );

  // Ensure that the factory is deployed
  const isContractDeployed = await isContract(
    smartAccountFactory.address,
    provider
  );
  if (!isContractDeployed) {
    throw new Error(
      `Smart Account Factory is not deployed on address ${smartAccountFactoryAddress}`
    );
  }

  // Ensure that the factory is not already staked
  const entrypoint = EntryPoint__factory.connect(entryPointAddress, signer);
  const depositInfo = await entrypoint.getDepositInfo(
    smartAccountFactory.address
  );
  if (depositInfo.staked) {
    throw new Error(
      `Smart Account Factory is already staked with ${formatEther(
        depositInfo.stake
      )} native tokens, unstake it before using this script`
    );
  }
  const chainId = (await provider.getNetwork()).chainId;
  if (!factoryStakeConfig[chainId]) {
    throw new Error(`Paymaster stake config not found for chainId ${chainId}`);
  }

  const { unstakeDelayInSec, stakeInWei } = factoryStakeConfig[chainId];
  const { hash, wait } = await smartAccountFactory.addStake(
    entryPointAddress,
    unstakeDelayInSec,
    {
      value: stakeInWei,
    }
  );
  console.log("SmartAccountFactory Stake Transaction Hash: ", hash);
  const { status } = await wait();
  console.log(
    "SmartAccountFactory Stake Transaction Status: ",
    status === 1 ? "Success" : "Failed"
  );
}

addStake();
