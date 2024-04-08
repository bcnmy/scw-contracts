import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-verify";
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
      {
        version: "0.8.23",
        settings: {
          evmVersion: "paris",
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
            chainId: 88018,
            forking: {
              url: process.env.AVAX_SUBNET_0001_TESTNET_URL,
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
    sepolia: {
      url: process.env.SEPOLIA_URL || "",
      chainId: 11155111,
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
    polygon_amoy: {
      url:
        process.env.POLYGON_AMOY_URL || "https://rpc-amoy.polygon.technology/",
      chainId: 80002,
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
    optimismSepolia: {
      url: `https://sepolia.optimism.io/`,
      accounts: hardhatAccounts,
      chainId: 11155420,
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
    comboMainnet: {
      url: process.env.COMBO_MAINNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 9980,
    },
    astarShibuyaTestnet: {
      url: process.env.ASTAR_SHIBUYA_URL || "https://evm.shibuya.astar.network",
      accounts: hardhatAccounts,
      chainId: 81,
    },
    astarMainnet: {
      url: process.env.ASTAR_MAINNET_URL || "https://evm.astar.network",
      accounts: hardhatAccounts,
      chainId: 592,
    },
    avaxSubnet0001Testnet: {
      url: process.env.AVAX_SUBNET_0001_TESTNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 88018,
    },
    capxTestnet: {
      url: process.env.CAPX_TESTNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 7116,
    },
    chillizTestnet: {
      url: process.env.CHILLIZ_TESTNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 88882,
    },
    chillizMainnet: {
      url: process.env.CHILLIZ_MAINNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 88888,
    },
    coreDaoTestnet: {
      url: process.env.COREDAO_TESTNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 1115,
    },
    coreDaoMainnet: {
      url: process.env.COREDAO_MAINNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 1116,
    },
    mantaTestnet: {
      url: process.env.MANTA_TESTNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 3441005,
    },
    mantaMainnet: {
      url: process.env.MANTA_MAINNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 169,
    },
    meterTestnet: {
      url: process.env.METER_TESTNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 83,
    },
    meterMainnet: {
      url: process.env.METER_MAINNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 82,
    },
    arbitrumSepoliaTestnet: {
      url: process.env.ARBITRUM_SEPOLIA_TESTNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 421614,
    },
    blastTestnet: {
      url: process.env.BLAST_TESTNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 168587773,
    },
    blastMainnet: {
      url: process.env.BLAST_MAINNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 81457,
    },
    scrollTestnet: {
      url: process.env.SCROLL_TESTNET_URL || "",
      accounts: hardhatAccounts,
      chainId: 534351,
    },
    scrollMainnet: {
      url: process.env.SCROLL_MAINNET_URL || "https://rpc.scroll.io/",
      accounts: hardhatAccounts,
      chainId: 534352,
    },
    baseSepoliaTestnet: {
      url: process.env.BASE_SEPOLIA_URL || "https://sepolia.base.org/",
      accounts: hardhatAccounts,
      chainId: 84532,
    },
    zetaTestnet: {
      url:
        process.env.ZETA_TESTNET_URL ||
        "https://rpc.ankr.com/zetachain_evm_athens_testnet",
      accounts: hardhatAccounts,
      chainId: 7001,
    },
    zetachainMainnet: {
      url:
        process.env.ZETA_MAINNET_URL ||
        "https://zetachain-mainnet-archive.allthatnode.com",
      accounts: hardhatAccounts,
      chainId: 7000,
    },
    beraTestnet: {
      url:
        process.env.BERA_TESTNET_URL ||
        "https://rpc.ankr.com/berachain_testnet",
      accounts: hardhatAccounts,
      chainId: 80085,
    },
    zeroOneTestnet: {
      url:
        process.env.ZERO_ONE_TESTNET ||
        "https://subnets.avax.network/testnetzer/testnet/rpc",
      accounts: hardhatAccounts,
      chainId: 56400,
    },
    zeroOneMainnet: {
      url:
        process.env.ZERO_ONE_MAINNET ||
        "https://subnets.avax.network/zeroonemai/mainnet/rpc",
      accounts: hardhatAccounts,
      chainId: 27827,
    },
    gold: {
      url:
        process.env.GOLD_CHAIN_MAINNET ||
        "https://chain-rpc.gold.dev/KNkWkhCZvD6YsVcqXqapzNADZKfkV4wC1",
      accounts: hardhatAccounts,
      chainId: 4653,
    },
    mantleSepolia: {
      url:
        process.env.MANTLE_SEPOLIA_TESTNET || "https://rpc.sepolia.mantle.xyz/",
      accounts: hardhatAccounts,
      chainId: 5003,
    },
    degenChain: {
      url: process.env.DEGEN_CHAIN_MAINNET || "https://rpc.degen.tips",
      accounts: hardhatAccounts,
      chainId: 666666666,
    },
    oliveTestnet: {
      url:
        process.env.OLIVE_TESTNET ||
        "https://olive-network-testnet.rpc.caldera.xyz/http",
      accounts: hardhatAccounts,
      chainId: 8101902,
    },
    cardonaTestnet: {
      url: process.env.OLIVE_TESTNET || "https://rpc.cardona.zkevm-rpc.com",
      accounts: hardhatAccounts,
      chainId: 2442,
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
      arbitrumGoerli: process.env.ARBITRUM_API_KEY || "",
      arbitrumNova: process.env.ARBITRUM_NOVA_API_KEY || "",
      arbitrumOne: process.env.ARBITRUM_API_KEY || "",
      arbitrumSepolia: process.env.ARBITRUM_API_KEY || "",
      arbitrumTestnet: process.env.ARBITRUM_API_KEY || "",
      astarMainnet: process.env.ASTAR_MAINNET_API_KEY || "",
      astarShibuyaTestnet: process.env.ASTAR_SHIBUYA_API_KEY || "",
      avalanche: process.env.AVALANCHE_API_KEY || "",
      avalancheFujiTestnet: process.env.AVALANCHE_API_KEY || "",
      baseGoerli: process.env.BASE_GOERLI_API_KEY || "",
      baseMainnet: process.env.BASE_MAINNET_API_KEY || "",
      baseSepoliaTestnet: process.env.BASE_SEPOLIA_API_KEY || "",
      beraTestnet: process.env.BERA_API_KEY || "PLACEHOLDER_STRING",
      blastTestnet: "PLACEHOLDER_STRING",
      blastMainnet: "PLACEHOLDER_STRING",
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      capxTestnet: "PLACEHOLDER_STRING",
      chillizMainnet: "PLACEHOLDER_STRING",
      chillizTestnet: "PLACEHOLDER_STRING",
      comboMainnet: process.env.COMBO_API_KEY || "",
      comboTestnet: process.env.COMBO_API_KEY || "",
      coreDaoMainnet: process.env.COREDAO_MAINNET_API_KEY || "",
      coreDaoTestnet: process.env.COREDAO_TESTNET_API_KEY || "",
      goerli: process.env.ETHERSCAN_API_KEY || "",
      lineaGoerli: "PLACEHOLDER_STRING",
      lineaMainnet: "PLACEHOLDER_STRING",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      mantaMainnet: "PLACEHOLDER_STRING",
      mantaTestnet: "PLACEHOLDER_STRING",
      mantleMainnet: "PLACEHOLDER_STRING",
      mantleTestnet: "PLACEHOLDER_STRING",
      mantleSepolia: "PLACEHOLDER_STRING",
      degenChain: "PLACEHOLDER_STRING",
      oliveTestnet: "PLACEHOLDER_STRING",
      cardonaTestnet: "PLACEHOLDER_STRING",
      moonbaseAlpha: process.env.MOONBEAM_KEY || "",
      moonbeam: process.env.MOONBEAM_KEY || "",
      opBNBMainnet: process.env.OP_BNB_API_KEY || "",
      opBNBTestnet: process.env.OP_BNB_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISTIC_API_KEY || "",
      optimisticGoerli: process.env.OPTIMISTIC_API_KEY || "",
      optimismSepolia: process.env.OPTIMISTIC_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
      scrollMainnet: process.env.SCROLL_API_KEY || "",
      scrollTestnet: process.env.SCROLL_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      zetaTestnet: process.env.ZETA_API_KEY || "PLACEHOLDER_STRING",
      zetachainMainnet: process.env.ZETA_API_KEY || "PLACEHOLDER_STRING",
      zkEVMGoerli: process.env.ZKEVM_API_KEY || "",
      zkEVMMainnet: process.env.ZKEVM_API_KEY || "",
    },
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
      {
        network: "mantaMainnet",
        chainId: 169,
        urls: {
          apiURL: "https://manta-pacific.calderaexplorer.xyz/api",
          browserURL: "https://manta-pacific.calderaexplorer.xyz",
        },
      },
      {
        network: "mantaTestnet",
        chainId: 3441005,
        urls: {
          apiURL: "https://pacific-explorer.testnet.manta.network/api/",
          browserURL: "https://pacific-explorer.testnet.manta.network/",
        },
      },
      {
        network: "coreDaoTestnet",
        chainId: 1115,
        urls: {
          apiURL: "https://api.test.btcs.network/api",
          browserURL: "https://scan.test.btcs.network/",
        },
      },
      {
        network: "coreDaoMainnet",
        chainId: 1116,
        urls: {
          apiURL: "https://openapi.coredao.org/api",
          browserURL: "https://scan.coredao.org/",
        },
      },
      {
        network: "capxTestnet",
        chainId: 7116,
        urls: {
          apiURL: "http://148.113.163.123:4010/api",
          browserURL: "http://148.113.163.123:4010",
        },
      },
      {
        network: "arbitrumNova",
        chainId: 42170,
        urls: {
          apiURL: "https://api-nova.arbiscan.io/api",
          browserURL: "https://nova.arbiscan.io/",
        },
      },
      {
        network: "chillizTestnet",
        chainId: 88882,
        urls: {
          apiURL: "https://spicy-explorer.chiliz.com/api",
          browserURL: "https://spicy-explorer.chiliz.com",
        },
      },
      {
        network: "chillizMainnet",
        chainId: 88888,
        urls: {
          apiURL: "https://scan.chiliz.com/api",
          browserURL: "https://scan.chiliz.com",
        },
      },
      {
        network: "capxTestnet",
        chainId: 7116,
        urls: {
          apiURL: "https://capxscan.com/api",
          browserURL: "https://capxscan.com",
        },
      },

      {
        network: "astarShibuyaTestnet",
        chainId: 81,
        urls: {
          apiURL: "https://blockscout.com/shibuya/api",
          browserURL: "https://blockscout.com/shibuya/",
        },
      },
      {
        network: "astarMainnet",
        chainId: 592,
        urls: {
          apiURL: "https://blockscout.com/astar/api",
          browserURL: "https://blockscout.com/astar/",
        },
      },
      {
        network: "lineaGoerli",
        chainId: 59140,
        urls: {
          apiURL: "https://api-testnet.lineascan.build/api",
          browserURL: "https://goerli.lineascan.build",
        },
      },
      {
        network: "optimismSepolia",
        chainId: 11155420,
        urls: {
          apiURL: "https://api-sepolia-optimism.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io/",
        },
      },
      {
        network: "lineaMainnet",
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://lineascan.build/",
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
        network: "mantleSepolia",
        chainId: 5003,
        urls: {
          apiURL: "https://explorer.sepolia.mantle.xyz/api",
          browserURL: "https://explorer.sepolia.mantle.xyz/",
        },
      },
      {
        network: "degenChain",
        chainId: 666666666,
        urls: {
          apiURL: "https://explorer.degen.tips/api",
          browserURL: "https://explorer.degen.tips",
        },
      },
      {
        network: "oliveTestnet",
        chainId: 8101902,
        urls: {
          apiURL: "https://olive-network-testnet.explorer.caldera.xyz/api",
          browserURL: "https://olive-network-testnet.explorer.caldera.xyz/",
        },
      },
      {
        network: "cardonaTestnet",
        chainId: 2442,
        urls: {
          apiURL: "https://cardona-zkevm.polygonscan.com/api",
          browserURL: "https://cardona-zkevm.polygonscan.com/",
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
      {
        network: "comboMainnet",
        chainId: 9980,
        urls: {
          apiURL: `https://open-platform.nodereal.io/${process.env.COMBO_API_KEY}/combotrace/contract/`,
          browserURL: "https://combotrace.nodereal.io/",
        },
      },
      {
        network: "blastTestnet",
        chainId: 168587773,
        urls: {
          apiURL:
            "https://api.routescan.io/v2/network/testnet/evm/168587773/etherscan",
          browserURL: "https://testnet.blastscan.io",
        },
      },
      {
        network: "blastMainnet",
        chainId: 81457,
        urls: {
          apiURL:
            "https://api.routescan.io/v2/network/testnet/evm/81457/etherscan",
          browserURL: "https://blastscan.io",
        },
      },
      {
        network: "scrollTestnet",
        chainId: 534351,
        urls: {
          apiURL: `https://api-sepolia.scrollscan.com/api`,
          browserURL: "https://sepolia.scrollscan.com",
        },
      },
      {
        network: "scrollMainnet",
        chainId: 534352,
        urls: {
          apiURL: `https://api.scrollscan.com/api`,
          browserURL: "https://scrollscan.com",
        },
      },
      {
        network: "baseSepoliaTestnet",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api/",
          browserURL: "https://sepolia.base.org/",
        },
      },
      {
        network: "zetaTestnet",
        chainId: 7001,
        urls: {
          apiURL: "https://eth-goerli.blockscout.com/api", // todo: review
          browserURL: "https://zetachain-athens-3.blockscout.com/",
        },
      },
      {
        network: "zetachainMainnet",
        chainId: 7000,
        urls: {
          apiURL: "https://eth-goerli.blockscout.com/api", // todo: review
          browserURL: "https://zetachain-athens-3.blockscout.com/", // review
        },
      },
      {
        network: "beraTestnet",
        chainId: 80085,
        urls: {
          apiURL:
            "https://api.routescan.io/v2/network/testnet/evm/80085/etherscan",
          browserURL: "https://artio.beratrail.io",
        },
      },
    ],
  },
};

export default config;
