import { network, ethers, config } from "hardhat";
import { mainDeploy } from "../scripts/deploy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { hexValue } from "ethers/lib/utils";

describe("Deployment", async function () {
  this.timeout(1000000);

  let deployerWallet: SignerWithAddress;

  before(async function () {
    const hardhatConfigChainId = config.networks.hardhat.chainId;
    if (hardhatConfigChainId === 31337) {
      this.skip();
    }

    if (!config?.networks?.hardhat?.forking?.url) {
      this.skip();
    }

    [deployerWallet] = await ethers.getSigners();

    console.log("Deployer address: ", deployerWallet.address);

    const networkProvider = new ethers.providers.JsonRpcProvider(
      config.networks.hardhat.forking.url
    );
    const realBalance = await networkProvider.getBalance(
      deployerWallet.address
    );
    if (realBalance === BigNumber.from(0)) {
      throw new Error("Deployer balance is zero");
    }

    await network.provider.send("hardhat_setBalance", [
      deployerWallet.address,
      hexValue(realBalance),
    ]);

    const realChainId = await networkProvider
      .getNetwork()
      .then((n) => n.chainId);
    if (hardhatConfigChainId !== realChainId) {
      throw new Error(
        `Hardhat config chainId ${hardhatConfigChainId} does not match real chainId ${realChainId}`
      );
    }

    await network.provider.send("evm_setIntervalMining", [50]);
  });

  it("Should deploy all the contracts", async () => {
    await mainDeploy();
  });
});
