import { providers, BigNumberish } from "ethers";

const BUNDLER_ENVIRONMENT_CHAIN_ID = 1337;

export const setupEnvironment = async (
  provider: providers.JsonRpcProvider,
  accountsToFund: string[],
  fundingAmount: BigNumberish[]
) => {
  const { chainId } = await provider.getNetwork();
  if (chainId !== BUNDLER_ENVIRONMENT_CHAIN_ID) {
    throw new Error(
      `Invalid chain id ${chainId} for bundler environment. Expected ${BUNDLER_ENVIRONMENT_CHAIN_ID}`
    );
  }

  const signer = provider.getSigner();
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
