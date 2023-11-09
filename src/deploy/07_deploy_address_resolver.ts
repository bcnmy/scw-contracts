import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  getEcdsaOwnershipRegistryModule,
  getSmartAccountFactory,
  getSmartAccountFactoryV1,
} from "../../test/utils/setupHelper";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const smartAccountFactoryV1 = await getSmartAccountFactoryV1();
  const smartAccountFactory = await getSmartAccountFactory();
  const ecdsaModule = await getEcdsaOwnershipRegistryModule();

  await deploy("AddressResolver", {
    from: deployer,
    args: [
      smartAccountFactoryV1.address,
      smartAccountFactory.address,
      ecdsaModule.address,
    ],
    log: true,
    deterministicDeployment: true,
    autoMine: true,
  });
};

deploy.tags = ["address-resolver", "main-suite"];
export default deploy;
