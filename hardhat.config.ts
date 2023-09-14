import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";

import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import "hardhat-dependency-compiler";
import { parseUnits } from "ethers/lib/utils";

const walletUtils = require("./walletUtils");

dotenv.config();

const shouldRunInForkMode = !!process.env.FORK_MODE;

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

const hardhatAccounts =
  process.env.PRIVATE_KEY !== undefined
    ? [process.env.PRIVATE_KEY]
    : walletUtils.makeKeyList();

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  paths: {
    artifacts: "artifacts",
    cache: "cache",
    deploy: "src/deploy",
    sources: "contracts",
  },
  namedAccounts: {
    deployer: 0,
    verifiedSigner: 5,
  },
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: { enabled: true, runs: 800 },
          viaIR: true,
        },
      },
    ],
  },
  networks: {
    hardhat: {
      ...(shouldRunInForkMode
        ? {
            // Forking Config for Deployment Testing
            chainId: 5000,
            forking: {
              url: process.env.MANTLE_MAINNET_URL,
            },
            accounts: [
              {
                privateKey: process.env.PRIVATE_KEY!,
                // This is a dummy value and will be overriden in the test by
                // the account's actual balance from the forked chain
                balance: "10000000000000000000000000",
              },
            ],
          }
        : {
            // Normal Config
            accounts: {
              accountsBalance: "10000000000000000000000000",
              //   mnemonic: MNEMONIC,
            },
            allowUnlimitedContractSize: true,
            chainId: 31337,
          }),
    },
    hardhat_node: {
      live: false,
      saveDeployments: false,
      chainId: 31337,
      url: "http://localhost:8545",
    },
    local: {
      live: false,
      saveDeployments: false,
      chainId: 1337,
      url: "http://localhost:8545",
      accounts: {
        mnemonic:
          "garbage miracle journey siren inch method pulse learn month grid frame business",
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 20,
      },
      gasPrice: parseUnits("1", "gwei").toNumber(),
    },
    eth_mainnet: {
      url: process.env.ETH_MAINNET_URL || "",
      chainId: 1,
      accounts: hardhatAccounts,
    },
    goerli: {
      url: process.env.GOERLI_URL || "",
      chainId: 5,
      accounts: hardhatAccounts,
    },
    polygon_mainnet: {
      url: process.env.POLYGON_URL || "",
      chainId: 137,
      accounts: hardhatAccounts,
      // : 200e9,
    },
    polygon_mumbai: {
      url: process.env.POLYGON_MUMBAI_URL || "",
      chainId: 80001,
      accounts: hardhatAccounts,
    },
    bnb_mainnet: {
      url: "https://bsc-dataseed2.binance.org",
      chainId: 56,
      accounts: hardhatAccounts,
    },
    bnb_testnet: {
      url:
        process.env.BSC_TESTNET_URL ||
        "https://wandering-broken-tree.bsc-testnet.quiknode.pro/7992da20f9e4f97c2a117bea9af37c1c266f63ec/",
      chainId: 97,
      accounts: hardhatAccounts,
      gasPrice: 50e9,
    },
    avalancheMain: {
      url: "https://api.avax.network/ext/bc/C/rpc",
      accounts: hardhatAccounts,
      chainId: 43114,
    },
    avalancheTest: {
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      accounts: hardhatAccounts,
      chainId: 43113,
    },
    arbitrumMain: {
      url: "https://arb1.arbitrum.io/rpc",
      accounts: hardhatAccounts,
      chainId: 42161,
    },
    arbitrumGoerli: {
      url: "https://goerli-rollup.arbitrum.io/rpc",
      accounts: hardhatAccounts,
      chainId: 421613,
      // gasPrice: 2e9, //2 gwei
    },
    arbitrumTest: {
      url: "https://rinkeby.arbitrum.io/rpc",
      accounts: hardhatAccounts,
      chainId: 421611,
    },
    arbitrumNova: {
      url: "https://nova.arbitrum.io/rpc",
      accounts: hardhatAccounts,
      chainId: 42170,
    },
    zkevm_mainnet: {
      url: process.env.ZKEVM_MAINNET_URL || "https://zkevm-rpc.com",
      chainId: 1101,
      accounts: hardhatAccounts,
    },
    zkevm_testnet: {
      url: process.env.ZKEVM_TESTNET_URL || "https://rpc.public.zkevm-test.net",
      chainId: 1442,
      accounts: hardhatAccounts,
      // gasPrice: 50e9,
    },
    optimismGoerli: {
      url: `https://goerli.optimism.io`,
      accounts: hardhatAccounts,
      chainId: 420,
    },
    optimismMainnet: {
      url: `https://mainnet.optimism.io`,
      accounts: hardhatAccounts,
      chainId: 10,
    },
    moonbeam_mainnet: {
      url: "https://rpc.api.moonbeam.network",
      chainId: 1284,
      accounts: hardhatAccounts,
    },
    moonbeamTest: {
      url: "https://rpc.api.moonbase.moonbeam.network",
      accounts: hardhatAccounts,
      chainId: 1287,
    },
    celoTestnet: {
      url: `https://alfajores-forno.celo-testnet.org`,
      accounts: walletUtils.makeKeyList(),
      chainId: 44787,
    },
    celoMainnet: {
      url: `https://forno.celo.org`,
      accounts: walletUtils.makeKeyList(),
      chainId: 42220,
    },
    neonDevnet: {
      url: `https://proxy.devnet.neonlabs.org/solana`,
      accounts: walletUtils.makeKeyList(),
      chainId: 245022926,
    },
    baseGoerli: {
      url:
        process.env.BASE_TESTNET_URL ||
        `https://base-goerli.blockpi.network/v1/rpc/public`,
      accounts: hardhatAccounts,
      chainId: 84531,
    },
    lineaGoerli: {
      url: process.env.LINEA_TESTNET_URL || `https://rpc.goerli.linea.build`,
      accounts: hardhatAccounts,
      chainId: 59140,
    },
    lineaMainnet: {
      url: process.env.LINEA_MAINNET_URL || ``,
      accounts: hardhatAccounts,
      chainId: 59144,
    },
    baseMainnet: {
      url:
        process.env.BASE_MAINNET_URL ||
        `https://developer-access-mainnet.base.org`,
      accounts: hardhatAccounts,
      chainId: 8453,
    },
    opBNBMainnet: {
      url: process.env.OP_BNB_MAINNET_URL,
      accounts: hardhatAccounts,
      chainId: 204,
    },
    opBNBTestnet: {
      url: process.env.OP_BNB_TESTNET_URL,
      accounts: hardhatAccounts,
      chainId: 5611,
    },
    mantleMainnet: {
      url: process.env.MANTLE_MAINNET_URL,
      accounts: hardhatAccounts,
      chainId: 5000,
    },
    mantleTestnet: {
      url: process.env.MANTLE_TESTNET_URL,
      accounts: hardhatAccounts,
      chainId: 5001,
    },
    comboTestnet: {
      url: process.env.COMBO_TESTNET_URL,
      accounts: hardhatAccounts,
      chainId: 91715,
    },
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    onlyCalledMethods: true,
  },

  dependencyCompiler: {
    paths: ["@account-abstraction/contracts/core/EntryPoint.sol"],
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      goerli: process.env.ETHERSCAN_API_KEY || "",
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
      moonbeam: process.env.MOONBEAM_KEY || "",
      moonbaseAlpha: process.env.MOONBEAM_KEY || "",
      avalancheFujiTestnet: process.env.AVALANCHE_API_KEY || "",
      avalanche: process.env.AVALANCHE_API_KEY || "",
      arbitrumGoerli: process.env.ARBITRUM_API_KEY || "",
      arbitrumTestnet: process.env.ARBITRUM_API_KEY || "",
      arbitrumOne: process.env.ARBITRUM_API_KEY || "",
      arbitrumNova: process.env.ARBITRUM_NOVA_API_KEY || "",
      optimisticGoerli: process.env.OPTIMISTIC_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISTIC_API_KEY || "",
      lineaGoerli: process.env.LINEA_API_KEY || "",
      lineaMainnet: process.env.LINEA_API_KEY || "",
      baseGoerli: process.env.BASE_GOERI_API_KEY || "",
      baseMainnet: process.env.BASE_MAINNET_API_KEY || "",
      zkEVMMainnet: process.env.ZKEVM_API_KEY || "",
      zkEVMGoerli: process.env.ZKEVM_API_KEY || "",
      opBNBTestnet: process.env.OP_BNB_API_KEY || "",
      opBNBMainnet: process.env.OP_BNB_API_KEY || "",
      mantleTestnet: "PLACEHOLDER_STRING",
      mantleMainnet: "PLACEHOLDER_STRING",
      comboTestnet: process.env.COMBO_API_KEY || "",
    },
    customChains: [
      {
        network: "arbitrumNova",
        chainId: 42170,
        urls: {
          apiURL: "https://api-nova.arbiscan.io/api",
          browserURL: "https://nova.arbiscan.io/",
        },
      },
      {
        network: "lineaGoerli",
        chainId: 59140,
        urls: {
          apiURL: "https://explorer.goerli.linea.build/api",
          browserURL: "https://goerli.lineascan.build",
        },
      },
      {
        network: "lineaMainnet",
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://lineascan.build",
        },
      },
      {
        network: "baseGoerli",
        chainId: 84531,
        urls: {
          apiURL: "https://api-goerli.basescan.org/api",
          browserURL: "https://goerli.basescan.org",
        },
      },
      {
        network: "baseMainnet",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "zkEVMMainnet",
        chainId: 1101,
        urls: {
          apiURL: "https://api-zkevm.polygonscan.com/api",
          browserURL: "https://zkevm.polygonscan.com",
        },
      },
      {
        network: "zkEVMGoerli",
        chainId: 1442,
        urls: {
          apiURL: "https://api-testnet-zkevm.polygonscan.com/api",
          browserURL: "https://testnet-zkevm.polygonscan.com",
        },
      },
      {
        network: "opBNBMainnet",
        chainId: 204,
        urls: {
          apiURL: `https://open-platform.nodereal.io/${process.env.OP_BNB_API_KEY}/op-bnb-mainnet/contract/`,
          browserURL: "https://mainnet.opbnbscan.com/",
        },
      },
      {
        network: "opBNBTestnet",
        chainId: 5611,
        urls: {
          apiURL: `https://open-platform.nodereal.io/${process.env.OP_BNB_API_KEY}/op-bnb-testnet/contract/`,
          browserURL: "https://opbscan.com",
        },
      },
      {
        network: "mantleMainnet",
        chainId: 5000,
        urls: {
          apiURL: "https://explorer.mantle.xyz/api",
          browserURL: "https://explorer.mantle.xyz",
        },
      },
      {
        network: "mantleTestnet",
        chainId: 5001,
        urls: {
          apiURL: "https://explorer.testnet.mantle.xyz/api",
          browserURL: "https://explorer.testnet.mantle.xyz",
        },
      },
      {
        network: "comboTestnet",
        chainId: 91715,
        urls: {
          apiURL: `https://open-platform.nodereal.io/${process.env.COMBO_API_KEY}/combotrace-testnet/contract/`,
          browserURL: "https://combotrace-testnet.nodereal.io",
        },
      },
    ],
  },
};

export default config;
