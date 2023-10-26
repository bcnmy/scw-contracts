import hardhat, { ethers } from "hardhat";
import { getContractAddress, parseEther } from "ethers/lib/utils";
import { Deployer__factory } from "../typechain";
import { DEPLOYMENT_CHAIN_GAS_PRICES } from "./utils";

export async function mainDeployDeployer() {
  try {
    const DEPLOYMENT_FEE = parseEther("0.1");

    console.log(
      " DEPLOYMENT_FEE %i : %f",
      DEPLOYMENT_FEE.toString(),
      ethers.utils.formatEther(DEPLOYMENT_FEE)
    );

    const provider = ethers.provider;
    const chainId = (await provider.getNetwork()).chainId;

    const DEPLOYMENT_GAS_PRICE = DEPLOYMENT_CHAIN_GAS_PRICES[chainId];
    if (!DEPLOYMENT_GAS_PRICE) {
      throw new Error(`No deployment gas price set for chain ${chainId}`);
    }

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
      const deployerContractDeployed = await new Deployer__factory(
        deployer
      ).deploy({ ...DEPLOYMENT_GAS_PRICE });
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

if (require.main === module) {
  mainDeployDeployer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
