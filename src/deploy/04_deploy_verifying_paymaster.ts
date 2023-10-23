import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getEntryPoint } from "../../test/utils/setupHelper";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const entryPoint = await getEntryPoint();

  await deploy("VerifyingSingletonPaymaster", {
    from: deployer,
    args: [deployer, entryPoint.address, deployer],
    log: true,
    deterministicDeployment: true, // Needed for bundler tests to ensure the entrypoint address does not change b/w tests
    autoMine: true,
  });
};

deploy.tags = ["verifying-paymaster", "main-suite"];
export default deploy;
