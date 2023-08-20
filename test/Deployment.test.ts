import { network, ethers, config } from "hardhat";
import { mainDeploy } from "../scripts/deploy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { formatEther, hexValue } from "ethers/lib/utils";

describe("Deployment", async function () {
  this.timeout(1000000);

  let deployerWallet: SignerWithAddress;

  before(async () => {
    if (!config?.networks?.hardhat?.forking?.url) {
      throw new Error("No forking url found in hardhat.config.ts");
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

    await network.provider.send("evm_setIntervalMining", [50]);

    console.log(
      "Deployer balance: ",
      formatEther(await deployerWallet.getBalance())
    );
  });

  it("Should deploy all the contracts", async () => {
    await mainDeploy();
  });

  after(async () => {
    console.log(
      "Deployer balance: ",
      formatEther(await deployerWallet.getBalance())
    );
  });
});
