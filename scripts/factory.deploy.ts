import { ethers } from "hardhat";
import {
    getContractAddress
} from "ethers/lib/utils";
import { Deployer__factory } from "../typechain";

async function main() {
    try {
        const provider = ethers.provider;

        const metaDeployerPrivateKey = process.env.FACTORY_DEPLOYER_PRIVATE_KEY;

        if (!metaDeployerPrivateKey) {
            throw new Error("FACTORY_DEPLOYER_PRIVATE_KEY not set");
        }
        const metaDeployer = new ethers.Wallet(
            metaDeployerPrivateKey,
            provider
        );

        const factoryAddress = getContractAddress({
            from: metaDeployer.address,
            nonce: 0,
        });

        const chainId = (await provider.getNetwork()).chainId;
        console.log(`Checking deployer ${factoryAddress} on chain ${chainId}...`);
        const code = await provider.getCode(factoryAddress);
        if (code === "0x") {
            console.log("Deployer not deployed, deploying...");
            const deployer = await new Deployer__factory(metaDeployer).deploy();
            await deployer.deployed();
            console.log(`Deployer deployed at ${deployer.address} on chain ${chainId}`);
        } else {
            console.log(`Deployer already deployed at  ${factoryAddress} on chain ${chainId}`);
        }
    } catch (error) {
        console.log('error while deploying factory');
        console.log(error);
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});