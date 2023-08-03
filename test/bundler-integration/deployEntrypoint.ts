import { BundlerTestEnvironment } from "./bundlerEnvironment";
import hre from "hardhat";
import deploy from "../../src/deploy/01_deploy_entrypoint";

if (require.main === module) {
  (async () => {
    await BundlerTestEnvironment.getDefaultInstance();
    await deploy(hre);
  })();
}
