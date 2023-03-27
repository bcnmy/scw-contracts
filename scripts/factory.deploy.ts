import { ethers } from "hardhat";
import { getContractAddress } from "ethers/lib/utils";
import { Deployer__factory } from "../typechain";
import { BigNumber } from "ethers";

async function main() {
  try {
    const deploymentGasPrice = 30e9;
    const deploymentGasLimit = 287000;
    const DEPLOYMENT_FEE = BigNumber.from(
      (deploymentGasPrice * deploymentGasLimit).toString()
    );
    console.log(" DEPLOYMENT_FEE ", DEPLOYMENT_FEE.toString());

    const provider = ethers.provider;

    const deployerKey = process.env.FACTORY_DEPLOYER_PRIVATE_KEY;

    if (!deployerKey) {
      throw new Error("FACTORY_DEPLOYER_PRIVATE_KEY not set");
    }
    const deployer = new ethers.Wallet(deployerKey, provider);
    const factoryAddress = getContractAddress({
      from: deployer.address,
      nonce: 0,
    });

    const chainId = (await provider.getNetwork()).chainId;
    console.log(`Checking deployer ${factoryAddress} on chain ${chainId}...`);
    const code = await provider.getCode(factoryAddress);
    if (code === "0x") {
      console.log("Deployer not deployed");
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
          await trx.wait(3);
          console.log("funds sent");
        }
      }
      console.log("Deploying Deployer...");
      const factoryDeployed = await new Deployer__factory(deployer).deploy();
      await factoryDeployed.deployed();
      console.log(
        `Deployer deployed at ${factoryDeployed.address} on chain ${chainId}`
      );
    } else {
      console.log(
        `Deployer already deployed at  ${factoryAddress} on chain ${chainId}`
      );
    }
  } catch (error) {
    console.log("error while deploying factory");
    console.log(error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
