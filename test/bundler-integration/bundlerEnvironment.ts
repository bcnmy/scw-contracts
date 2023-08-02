import { providers, BigNumberish, utils, BigNumber } from "ethers";
import axios, { AxiosInstance } from "axios";
import { ethers, config } from "hardhat";
import type { HttpNetworkConfig } from "hardhat/types";

type Snapshot = {
  blockNumber: number;
};

export class BundlerTestEnvironment {
  BUNDLER_ENVIRONMENT_CHAIN_ID = 1337;
  DEFAULT_FUNDING_AMOUNT = utils.parseEther("10");

  private apiClient: AxiosInstance;
  private static instance: BundlerTestEnvironment;

  constructor(
    public readonly provider: providers.JsonRpcProvider,
    public readonly bundlerUrl: string
  ) {
    this.apiClient = axios.create({
      baseURL: this.bundlerUrl,
    });
  }

  init = async () => {
    const { chainId } = await this.provider.getNetwork();
    if (chainId !== this.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      throw new Error(
        `Invalid chain id ${chainId} for bundler environment. Expected ${this.BUNDLER_ENVIRONMENT_CHAIN_ID}`
      );
    }
  };

  static getDefaultInstance = async () => {
    if (this.instance) {
      return this.instance;
    }

    this.instance = new BundlerTestEnvironment(
      new providers.JsonRpcProvider(
        (config.networks.local as HttpNetworkConfig).url
      ),
      "http://localhost:3000"
    );

    await this.instance.init();

    const defaultSigners = await ethers.getSigners();
    await this.instance.fundAccounts(
      defaultSigners.map((signer) => signer.address),
      defaultSigners.map((_) => this.instance.DEFAULT_FUNDING_AMOUNT)
    );

    return this.instance;
  };

  fundAccounts = async (
    accountsToFund: string[],
    fundingAmount: BigNumberish[]
  ) => {
    const signer = this.provider.getSigner();
    const nonce = await signer.getTransactionCount();
    await Promise.all(
      accountsToFund.map((account, i) =>
        signer.sendTransaction({
          to: account,
          value: fundingAmount[i],
          nonce: nonce + i,
        })
      )
    );
  };

  snapshot = async (): Promise<Snapshot> => ({
    blockNumber: await this.provider.getBlockNumber(),
  });

  revert = async (snapshot: Snapshot) => {
    await this.provider.send("debug_setHead", [
      utils.hexValue(BigNumber.from(snapshot.blockNumber)),
    ]);
    const currentBlockNumber = await this.provider.getBlockNumber();
    if (currentBlockNumber !== snapshot.blockNumber) {
      throw new Error(
        `Failed to revert to block ${snapshot.blockNumber}. Current block number is ${currentBlockNumber}`
      );
    }
  };
}
