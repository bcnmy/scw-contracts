import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    await deploy("EntryPoint", {
        from: deployer,
        args: [],
        log: true,
        deterministicDeployment: true,
        autoMine: true,
    });
};

deploy.tags = ["entry-point", "main-suite"];
export default deploy;
