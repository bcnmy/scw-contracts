import { ethers, config } from "hardhat";
import { setupEnvironment } from "./setupEnvironment";
import { HttpNetworkConfig } from "hardhat/types";

describe("Bundler Envitonment", async () => {
  const signers = await ethers.getSigners();

  it("Default Signers Should have funds after environment setup", async () => {
    await setupEnvironment(
      new ethers.providers.JsonRpcProvider(
        (config.networks.local as HttpNetworkConfig).url
      ),
      signers.map((signer) => signer.address),
      signers.map((_) => ethers.utils.parseEther("100"))
    );

    for (const signer of signers) {
      expect(await ethers.provider.getBalance(signer.address)).to.be.gte(
        ethers.utils.parseEther("100")
      );
    }
  });
});
