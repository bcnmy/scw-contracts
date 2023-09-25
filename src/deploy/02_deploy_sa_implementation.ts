import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getEntryPoint } from "../../test/utils/setupHelper";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const entryPoint = await getEntryPoint();

  await deploy("SmartAccount", {
    from: deployer,
    args: [entryPoint.address],
    log: true,
    deterministicDeployment: true,
    autoMine: true,
  });
};

deploy.tags = ["smart-account-implementation", "main-suite"];
export default deploy;
