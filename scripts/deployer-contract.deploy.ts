import { ethers } from "hardhat";
import { getContractAddress } from "ethers/lib/utils";
import { Deployer__factory } from "../typechain";
import { BigNumber } from "ethers";
import hardhat from "hardhat";

async function main() {
  try {
    const deploymentGasPrice = getDeploymentGasPrice();
    console.log("deploymentGasPrice ", deploymentGasPrice);
    const deploymentGasLimit = 287000;
    const DEPLOYMENT_FEE = BigNumber.from(
      (deploymentGasPrice * deploymentGasLimit).toString()
    );
    console.log(" DEPLOYMENT_FEE ", DEPLOYMENT_FEE.toString());

    const provider = ethers.provider;

    const deployerKey = process.env.DEPLOYER_CONTRACT_DEPLOYER_PRIVATE_KEY;

    if (!deployerKey) {
      throw new Error("DEPLOYER_CONTRACT_DEPLOYER_PRIVATE_KEY not set");
    }
    const deployer = new ethers.Wallet(deployerKey, provider);
    
    const deployerContractAddress = getContractAddress({
      from: deployer.address,
      nonce: 0,
    });

    const chainId = (await provider.getNetwork()).chainId;
    console.log(`Checking deployer contract ${deployerContractAddress} on chain ${chainId}...`);
    const code = await provider.getCode(deployerContractAddress);
    if (code === "0x") {
      console.log("Deployer contract has not been deployed yet");
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      console.log("signerAddress", signerAddress);
      console.log("deployer ", deployer.address);
      const [deployerBalance, signerBalance] = await Promise.all([
        provider.getBalance(deployer.address),
        provider.getBalance(signerAddress),
      ]);
      console.log("Deployer Balance", deployerBalance);
      console.log("Signer Balance", signerBalance);

      if (deployerBalance.lt(DEPLOYMENT_FEE)) {
        const fundsNeeded = DEPLOYMENT_FEE.sub(deployerBalance);
        console.log("fundsNeeded ", fundsNeeded);
        if (signerBalance.gt(fundsNeeded)) {
          console.log("sending funds");
          const trx = await signer.sendTransaction({
            to: deployer.address,
            value: fundsNeeded,
          });
          await trx.wait();
          console.log("funds sent");
        }
      }
      console.log("Deploying Deployer Contract...");
      const deployerContractDeployed = await new Deployer__factory(deployer).deploy();
      await deployerContractDeployed.deployed();
      console.log(
        "Deployed new Deployer Contract at %s on chain %s: %i", deployerContractDeployed.address, hardhat.network.name, chainId
      );
    } else {
      console.log(
        "Deployer Contract has already been deployed at %s on chain %s: %i", deployerContractAddress, hardhat.network.name, chainId
      );
    }
  } catch (error) {
    console.log("error while deploying Deployer Contract");
    console.log(error);
  }
}

function getDeploymentGasPrice(): number {
  if (hardhat.network.name === "polygon_mumbai" && hardhat.network.config.chainId === 80001) {
    return 9e9;
  } else if (hardhat.network.name === "goerli" && hardhat.network.config.chainId === 5) {
    return 300e9;
  } else if (hardhat.network.name === "arbitrumGoerli" && hardhat.network.config.chainId === 421613) {
    return 14e8; //1.4 Gwei
  } else if (hardhat.network.name === "avalancheTest" && hardhat.network.config.chainId === 43113) {
    return 30e9; //30 nAvax
  } else {
    return hardhat.network.config.gasPrice === "auto" ? 100e9 : hardhat.network.config.gasPrice;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
