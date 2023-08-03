import { getEntryPoint } from "../utils/setupHelper";
import { deployments } from "hardhat";
import { BundlerTestEnvironment } from "./bundlerEnvironment";

if (require.main === module) {
  (async () => {
    await BundlerTestEnvironment.getDefaultInstance();
    await deployments.createFixture(async ({ deployments }) => {
      await deployments.fixture();
      const entrypoint = await getEntryPoint();
      console.log("Entrypoint deployed at", entrypoint.address);
    })();
  })();
}
