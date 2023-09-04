import hardhat, { ethers } from "hardhat";
import { getContractAddress } from "ethers/lib/utils";
import { Deployer__factory } from "../typechain";
import { BigNumber } from "ethers";

async function main() {
  try {
    const deploymentGasPrice = getDeploymentGasPrice();
    console.log(
      "deploymentGasPrice %i : %f gwei",
      deploymentGasPrice,
      ethers.utils.formatUnits(deploymentGasPrice, "gwei")
    );
    const deploymentGasLimit = 287000;
    const DEPLOYMENT_FEE = BigNumber.from(
      (deploymentGasPrice * deploymentGasLimit).toString()
    );
    console.log(
      " DEPLOYMENT_FEE %i : %f",
      DEPLOYMENT_FEE.toString(),
      ethers.utils.formatEther(DEPLOYMENT_FEE)
    );

    const provider = ethers.provider;

    const deployerKey = process.env.DEPLOYER_CONTRACT_DEPLOYER_PRIVATE_KEY;
    if (!deployerKey) {
      throw new Error("DEPLOYER_CONTRACT_DEPLOYER_PRIVATE_KEY not set");
    }
    const deployer = new ethers.Wallet(deployerKey, provider);

    const fundingAccountKey = process.env.FUNDING_ACCOUNT_PRIVATE_KEY;
    if (!fundingAccountKey) {
      throw new Error("FUNDING_ACCOUNT_PRIVATE_KEY not set");
    }
    const fundingAccount = new ethers.Wallet(fundingAccountKey, provider);

    const deployerContractAddress = getContractAddress({
      from: deployer.address,
      nonce: 0,
    });

    const chainId = (await provider.getNetwork()).chainId;
    console.log(
      `Checking deployer contract ${deployerContractAddress} on chain ${chainId}...`
    );
    const code = await provider.getCode(deployerContractAddress);
    if (code === "0x") {
      console.log("Deployer contract has not been deployed yet");

      console.log("Funding eoa address", fundingAccount.address);
      console.log("Deployer eoa address", deployer.address);
      const [deployerBalance, signerBalance] = await Promise.all([
        provider.getBalance(deployer.address),
        provider.getBalance(fundingAccount.address),
      ]);
      console.log(
        "Deployer Balance %f : %f",
        deployerBalance,
        ethers.utils.formatEther(deployerBalance)
      );
      console.log(
        "Signer Balance %f : %f",
        signerBalance,
        ethers.utils.formatEther(signerBalance)
      );

      if (deployerBalance.lt(DEPLOYMENT_FEE)) {
        const fundsNeeded = DEPLOYMENT_FEE.sub(deployerBalance);
        console.log("fundsNeeded ", ethers.utils.formatEther(fundsNeeded));
        if (signerBalance.gt(fundsNeeded)) {
          console.log("sending funds");
          const trx = await fundingAccount.sendTransaction({
            to: deployer.address,
            value: fundsNeeded,
          });
          await trx.wait();
          console.log("funds sent");
        } else {
          throw new Error("Not enough funds on funding contract");
        }
      }
      console.log("Deploying Deployer Contract...");
      // const deployerContractDeployed = await new Deployer__factory(deployer).deploy({maxFeePerGas: 350e9, maxPriorityFeePerGas: 100e9, nonce: 0});
      const deployerContractDeployed = await new Deployer__factory(
        deployer
      ).deploy();
      await deployerContractDeployed.deployed();
      console.log(
        "Deployed new Deployer Contract at %s on chain %s: %i",
        deployerContractDeployed.address,
        hardhat.network.name,
        chainId
      );
    } else {
      console.log(
        "Deployer Contract has already been deployed at %s on chain %s: %i",
        deployerContractAddress,
        hardhat.network.name,
        chainId
      );
    }
  } catch (error) {
    console.log("error while deploying Deployer Contract");
    console.log(error);
  }
}

function getDeploymentGasPrice(): number {
  // TESTNETS
  if (
    hardhat.network.name === "polygon_mumbai" &&
    hardhat.network.config.chainId === 80001
  ) {
    return 50e9;
  } else if (
    hardhat.network.name === "goerli" &&
    hardhat.network.config.chainId === 5
  ) {
    return 400e9;
  } else if (
    hardhat.network.name === "avalancheTest" &&
    hardhat.network.config.chainId === 43113
  ) {
    return 50e9; // 50 nAvax
  } else if (
    hardhat.network.name === "arbitrumGoerli" &&
    hardhat.network.config.chainId === 421613
  ) {
    return 10e9; // 10 Gwei
  } else if (
    hardhat.network.name === "optimismGoerli" &&
    hardhat.network.config.chainId === 420
  ) {
    return 10e9; // 10 gwei
  } else if (
    hardhat.network.name === "bnb_testnet" &&
    hardhat.network.config.chainId === 97
  ) {
    return 50e9; // 50 gwei
  } else if (
    hardhat.network.name === "zkevm_testnet" &&
    hardhat.network.config.chainId === 1442
  ) {
    return 100e9; // 100 gwei
    // MAINNETS
  } else if (
    hardhat.network.name === "polygon_mainnet" &&
    hardhat.network.config.chainId === 137
  ) {
    return 500e9; // 500 gwei
  } else if (
    hardhat.network.name === "eth_mainnet" &&
    hardhat.network.config.chainId === 1
  ) {
    return 50e9; // 50 gwei
  } else if (
    hardhat.network.name === "avalancheMain" &&
    hardhat.network.config.chainId === 43114
  ) {
    return 50e9; // 50 gwei
  } else if (
    hardhat.network.name === "arbitrumMain" &&
    hardhat.network.config.chainId === 42161
  ) {
    return 1e9; // 1 gwei
  } else if (
    hardhat.network.name === "optimismMainnet" &&
    hardhat.network.config.chainId === 10
  ) {
    return 1e8; // 0.1 gwei
  } else if (
    hardhat.network.name === "bnb_mainnet" &&
    hardhat.network.config.chainId === 56
  ) {
    return 10e9; // 10 gwei
  } else if (
    hardhat.network.name === "zkevm_mainnet" &&
    hardhat.network.config.chainId === 1101
  ) {
    return 10e9; // 500 gwei
    // OTHERWISE CHECK HARDHAT CONFIG. IF NOT SET IN CONFIG, USE 100 GWEI
  } else {
    return hardhat.network.config.gasPrice === "auto"
      ? 100e9
      : hardhat.network.config.gasPrice;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
