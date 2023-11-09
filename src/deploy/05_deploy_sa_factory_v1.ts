import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  getSmartAccountImplementationV1,
  getEntryPoint,
} from "../../test/utils/setupHelper";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const smartAccountImplementation = await getSmartAccountImplementationV1();

  await deploy("SmartAccountFactoryV1", {
    from: deployer,
    args: [smartAccountImplementation.address],
    log: true,
    deterministicDeployment: true,
    autoMine: true,
  });
};

deploy.tags = ["smart-account-factory-v1", "main-suite"];
export default deploy;
