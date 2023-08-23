import { providers, BigNumberish, utils } from "ethers";
import axios, { AxiosInstance } from "axios";
import { ethers, config, getNamedAccounts } from "hardhat";
import type { HttpNetworkConfig } from "hardhat/types";
import { UserOperation } from "../../utils/userOperation";
import { serializeUserOp } from "../../utils/userOp";

export class UserOperationSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserOperationSubmissionError";
  }
}
export class BundlerResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleResetError";
  }
}

export class BundlerTestEnvironment {
  public static BUNDLER_ENVIRONMENT_CHAIN_ID = 1337;
  public static DEFAULT_FUNDING_AMOUNT = utils.parseEther("1000000");

  DOCKER_COMPOSE_DIR = __dirname;
  DOCKER_COMPOSE_BUNDLER_SERVICE = "bundler";

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

    const defaultAddresses = Array.from(
      new Set([
        ...(await ethers.getSigners()).map((signer) => signer.address),
        ...Object.entries(await getNamedAccounts()).map(
          ([, address]) => address
        ),
      ])
    );
    await this.instance.fundAccounts(
      defaultAddresses,
      defaultAddresses.map((_) => this.DEFAULT_FUNDING_AMOUNT)
    );

    return this.instance;
  };

  fundAccounts = async (
    accountsToFund: string[],
    fundingAmount: BigNumberish[]
  ) => {
    const signer = this.provider.getSigner();
    const nonce = await signer.getTransactionCount();
    accountsToFund = (
      await Promise.all(
        accountsToFund.map(
          async (account, i): Promise<[string, boolean]> => [
            account,
            (await this.provider.getBalance(account)).lt(fundingAmount[i]),
          ]
        )
      )
    )
      .filter(([, needsFunding]) => needsFunding)
      .map(([account]) => account);
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

  sendUserOperation = async (
    userOperation: UserOperation,
    entrypointAddress: string
  ): Promise<string> => {
    const result = await this.apiClient.post("/rpc", {
      jsonrpc: "2.0",
      method: "eth_sendUserOperation",
      params: [serializeUserOp(userOperation), entrypointAddress],
    });
    if (result.status !== 200) {
      throw new Error(
        `Failed to send user operation: ${JSON.stringify(
          result.data.error.message
        )}`
      );
    }
    if (result.data.error) {
      throw new UserOperationSubmissionError(JSON.stringify(result.data.error));
    }

    return result.data;
  };

  resetBundler = async () => {
    const result = await this.apiClient.post("/rpc", {
      jsonrpc: "2.0",
      method: "debug_bundler_clearState",
      params: [],
    });
    if (result.status !== 200) {
      throw new Error(
        `Failed to send reset bundler: ${JSON.stringify(
          result.data.error.message
        )}`
      );
    }
    if (result.data.error) {
      throw new BundlerResetError(JSON.stringify(result.data.error));
    }

    if (result.data.result !== "ok") {
      throw new BundlerResetError(
        `Failed to reset bundler: ${JSON.stringify(result.data.result)}`
      );
    }
  };

  dumpMempool = async () => {
    const result = await this.apiClient.post("/rpc", {
      jsonrpc: "2.0",
      method: "debug_bundler_dumpMempool",
      params: [],
    });
    if (result.status !== 200) {
      throw new Error(
        `Failed to send reset bundler: ${JSON.stringify(
          result.data.error.message
        )}`
      );
    }
    if (result.data.error) {
      throw new BundlerResetError(JSON.stringify(result.data.error));
    }

    return result.data.result;
  };
}
