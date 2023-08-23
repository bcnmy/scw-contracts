import { ethers as hardhatEthersInstance } from "hardhat";
import { BigNumber, BigNumberish, Contract, ethers } from "ethers";
import {
  arrayify,
  hexConcat,
  hexlify,
  hexZeroPad,
  keccak256,
  Interface,
  parseUnits,
  parseEther,
} from "ethers/lib/utils";
import { TransactionReceipt, Provider } from "@ethersproject/providers";
import { Deployer, Deployer__factory } from "../../typechain";

// { FACTORY_ADDRESS  } is deployed from chirag's private key for nonce 0
export const FACTORY_ADDRESS = "0x757056493cd5E44e4cFe2719aE05FbcfC1178087";
export const FACTORY_BYTE_CODE =
  "0x6080604052348015600f57600080fd5b506004361060285760003560e01c80634af63f0214602d575b600080fd5b60cf60048036036040811015604157600080fd5b810190602081018135640100000000811115605b57600080fd5b820183602082011115606c57600080fd5b80359060200191846001830284011164010000000083111715608d57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929550509135925060eb915050565b604080516001600160a01b039092168252519081900360200190f35b6000818351602085016000f5939250505056fea26469706673582212206b44f8a82cb6b156bfcc3dc6aadd6df4eefd204bc928a4397fd15dacf6d5320564736f6c63430006020033";
export const factoryDeployer = "0xBb6e024b9cFFACB947A71991E386681B1Cd1477D";
export const factoryTx =
  "0xf9016c8085174876e8008303c4d88080b90154608060405234801561001057600080fd5b50610134806100206000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80634af63f0214602d575b600080fd5b60cf60048036036040811015604157600080fd5b810190602081018135640100000000811115605b57600080fd5b820183602082011115606c57600080fd5b80359060200191846001830284011164010000000083111715608d57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929550509135925060eb915050565b604080516001600160a01b039092168252519081900360200190f35b6000818351602085016000f5939250505056fea26469706673582212206b44f8a82cb6b156bfcc3dc6aadd6df4eefd204bc928a4397fd15dacf6d5320564736f6c634300060200331b83247000822470";
export const factoryTxHash =
  "0x803351deb6d745e91545a6a3e1c0ea3e9a6a02a1a4193b70edfcd2f40f71a01c";

const factoryDeploymentFee = (0.0247 * 1e18).toString(); // 0.0247
const options = { gasLimit: 7000000 /*, gasPrice: 70000000000 */ };

// // Dev Salts
// export enum DEPLOYMENT_SALTS {
//   DECODER = "DEVX_DECODER_V0_21082023",
//   ENTRY_POINT = "DEVX_ENTRY_POINT_V0_30032023",
//   GAS_ESTIMATOR = "DEVX_GAS_ESTIMATOR_V0_21082023",
//   MULTI_SEND = "DEVX_MULTI_SEND_V0_21082023",
//   MULTI_SEND_CALLONLY = "DEVX_MULTI_SEND_CALLONLY_V0_21082023",
//   WALLET_FACTORY = "DEVX_WALLET_FACTORY_V0_21082023",
//   WALLET_IMP = "DEVX_WALLET_IMP_V0_21082023",
//   SINGELTON_PAYMASTER = "DEVX_SINGLETON_PAYMASTER_V1_21082024",
//   ECDSA_REGISTRY_MODULE = "DEVX_ECDSA_REGISTRY_MODULE_V0_21082023",
//   MULTICHAIN_VALIDATOR_MODULE = "DEVX_MULTICHAIN_VALIDATOR_MODULE_V0_21082023",
//   PASSKEY_MODULE = "DEVX_PASSKEY_MODULE_V0_21082023",
//   SESSION_KEY_MANAGER_MODULE = "DEVX_SESSION_KEY_MANAGER_MODULE_V0_21082023",
//   ERC20_SESSION_VALIDATION_MODULE = "DEVX_ERC20_SESSION_VALIDATION_MODULE_V0_21082023",
//   SMART_CONTRACT_OWNERSHIP_REGISTRY_MODULE = "DEVX_SMART_CONTRACT_OWNERSHIP_REGISTRY_MODULE_V0_21082023",
// }

// Prod Salts
export enum DEPLOYMENT_SALTS {
  DECODER = "",
  ENTRY_POINT = "DEVX_ENTRY_POINT_V0_30032023",
  GAS_ESTIMATOR = "",
  MULTI_SEND = "",
  MULTI_SEND_CALLONLY = "",
  WALLET_FACTORY = "PROD_WALLET_FACTORY_V1_22082023_4vDXpHR",
  WALLET_IMP = "PROD_WALLET_IMP_V1_22082023_neuwImd",
  SINGELTON_PAYMASTER = "PROD_SINGLETON_PAYMASTER_V1_22082023N4hlwuH",
  ECDSA_REGISTRY_MODULE = "PROD_ECDSA_REGISTRY_MODULE_V1_22082023_ypI3tHh",
  MULTICHAIN_VALIDATOR_MODULE = "PROD_MULTICHAIN_VALIDATOR_MODULE_V1_22082023_vdQZbfh",
  PASSKEY_MODULE = "PROD_PASSKEY_MODULE_V1_22082023_n0nz9WE",
  SESSION_KEY_MANAGER_MODULE = "PROD_SESSION_KEY_MANAGER_MODULE_V1_22082023_o3aiYAr",
  ERC20_SESSION_VALIDATION_MODULE = "PROD_ERC20_SESSION_VALIDATION_MODULE_V1_22082023_QCLznax",
  SMART_CONTRACT_OWNERSHIP_REGISTRY_MODULE = "PROD_SMART_CONTRACT_OWNERSHIP_REGISTRY_MODULE_V1_22082023_6X7yarN",
}

export const DEPLOYMENT_CHAIN_GAS_PRICES: Record<
  number,
  | { maxFeePerGas?: BigNumberish; maxPriorityFeePerGas?: BigNumberish }
  | { gasPrice: BigNumberish }
> = {
  // Testnets
  80001: { gasPrice: parseUnits("100", "gwei") },
  97: { gasPrice: parseUnits("5", "gwei") },
  5: {
    maxPriorityFeePerGas: parseUnits("1", "gwei"),
    maxFeePerGas: parseUnits("100", "gwei"),
  },
  421613: {
    gasPrice: parseUnits("0.1", "gwei"),
  },
  420: {
    gasPrice: parseUnits("0.1", "gwei"),
  },
  43113: {
    gasPrice: parseUnits("30", "gwei"),
  },
  1442: {
    gasPrice: parseUnits("1", "gwei"),
  },
  59140: {
    gasPrice: parseUnits("0.1", "gwei"),
  },
  84531: {
    gasPrice: parseUnits("1.5", "gwei"),
  },

  // Mainnets
  137: { maxPriorityFeePerGas: parseUnits("50", "gwei") },
  56: { maxPriorityFeePerGas: parseUnits("10", "gwei") },
  1: { maxPriorityFeePerGas: parseUnits("30", "gwei") },
  42161: { gasPrice: parseUnits("1", "gwei") },
  10: { gasPrice: parseUnits("1", "gwei") },
  43114: { gasPrice: parseUnits("30", "gwei") },
  1101: { gasPrice: parseUnits("1", "gwei") },
  59144: { gasPrice: parseUnits("2", "gwei") },
  8453: { gasPrice: parseUnits("1.5", "gwei") },
};

type StakingConfig = {
  unstakeDelayInSec: number;
  stakeInWei: BigNumber;
};

export const factoryStakeConfig: Record<number, StakingConfig> = {
  // Testnets
  80001: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.01"),
  },
  97: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.01"),
  },
  5: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.01"),
  },
  421613: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.01"),
  },
  420: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.01"),
  },
  43113: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.01"),
  },
  1442: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.01"),
  },
  59140: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.01"),
  },
  84531: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.01"),
  },

  // Mainnets
  137: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("173"), // 1 MATIC = $0.5788
  },
  56: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.46"), // 1 BNB = $217.43
  },
  1: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.06"), // 1 ETH = $1,674.88
  },
  42161: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.06"), // 1 ETH = $1,674.88
  },
  10: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.06"), // 1 ETH = $1,674.88
  },
  43114: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("9.337"), // 1 AVAX = $10.71
  },
  1101: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.06"), // 1 ETH = $1,674.88
  },
  59144: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.06"), // 1 ETH = $1,674.88
  },
  8453: {
    unstakeDelayInSec: 60 * 60 * 24, // 1 Day
    stakeInWei: parseEther("0.06"), // 1 ETH = $1,674.88
  },
};

export const factoryAbi = [
  {
    inputs: [
      { internalType: "bytes", name: "_initCode", type: "bytes" },
      { internalType: "bytes32", name: "_salt", type: "bytes32" },
    ],
    name: "deploy",
    outputs: [
      {
        internalType: "address payable",
        name: "createdContract",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const buildBytecode = (
  constructorTypes: any[],
  constructorArgs: any[],
  contractBytecode: string
) =>
  `${contractBytecode}${encodeParams(constructorTypes, constructorArgs).slice(
    2
  )}`;

export const buildCreate2Address = (saltHex: string, byteCode: string) => {
  return `0x${ethers.utils
    .keccak256(
      `0x${["ff", FACTORY_ADDRESS, saltHex, ethers.utils.keccak256(byteCode)]
        .map((x) => x.replace(/0x/, ""))
        .join("")}`
    )
    .slice(-40)}`.toLowerCase();
};

/**
 * return the deployed address of this code.
 * (the deployed address to be used by deploy()
 * @param initCode
 * @param salt
 */
export const getDeployedAddress = (initCode: string, salt: BigNumberish) => {
  const saltBytes32 = hexZeroPad(hexlify(salt), 32);
  return (
    "0x" +
    keccak256(
      hexConcat(["0xff", FACTORY_ADDRESS, saltBytes32, keccak256(initCode)])
    ).slice(-40)
  );
};

export const getDeployerInstance = async (): Promise<Deployer> => {
  const metaDeployerPrivateKey = process.env.FACTORY_DEPLOYER_PRIVATE_KEY;
  if (!metaDeployerPrivateKey) {
    throw new Error("FACTORY_DEPLOYER_PRIVATE_KEY not set");
  }
  const metaDeployer = new ethers.Wallet(
    metaDeployerPrivateKey,
    hardhatEthersInstance.provider
  );
  // const FACTORY_ADDRESS = getContractAddress({
  //   from: metaDeployer.address,
  //   nonce: 0,
  // });

  const provider = hardhatEthersInstance.provider;
  const [signer] = await hardhatEthersInstance.getSigners();
  const chainId = (await provider.getNetwork()).chainId;
  console.log(`Checking deployer ${FACTORY_ADDRESS} on chain ${chainId}...`);
  const code = await provider.getCode(FACTORY_ADDRESS);
  if (code === "0x") {
    console.log("Deployer not deployed, deploying...");
    const metaDeployerPrivateKey = process.env.FACTORY_DEPLOYER_PRIVATE_KEY;
    if (!metaDeployerPrivateKey) {
      throw new Error("FACTORY_DEPLOYER_PRIVATE_KEY not set");
    }
    const metaDeployerSigner = new ethers.Wallet(
      metaDeployerPrivateKey,
      provider
    );
    const deployer = await new Deployer__factory(metaDeployerSigner).deploy();
    await deployer.deployed();
    console.log(`Deployer deployed at ${deployer.address} on chain ${chainId}`);
  } else {
    console.log(`Deployer already deployed on chain ${chainId}`);
  }

  return Deployer__factory.connect(FACTORY_ADDRESS, signer);
};

export const deployContract = async (
  name: string,
  computedContractAddress: string,
  salt: string,
  contractByteCode: string,
  deployerInstance: Deployer
): Promise<string> => {
  const chainId = (await hardhatEthersInstance.provider.getNetwork()).chainId;
  const deploymentGasPrice = DEPLOYMENT_CHAIN_GAS_PRICES[chainId];
  if (!deploymentGasPrice) {
    throw new Error(`No deployment gas price set for chain ${chainId}`);
  }
  const { hash, wait } = await deployerInstance.deploy(salt, contractByteCode, {
    ...deploymentGasPrice,
  });

  console.log(`Submitted transaction ${hash} for deployment`);

  const { status, logs, blockNumber } = await wait(5);

  if (status !== 1) {
    throw new Error(`Transaction ${hash} failed`);
  }

  console.log(`Transaction ${hash} is included in block ${blockNumber}`);

  // Get the address of the deployed contract
  const topicHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("ContractDeployed(address)")
  );
  const contractDeployedLog = logs.find((log) => log.topics[0] === topicHash);

  if (!contractDeployedLog) {
    throw new Error(`Transaction ${hash} did not emit ContractDeployed event`);
  }

  const deployedContractAddress =
    deployerInstance.interface.parseLog(contractDeployedLog).args
      .contractAddress;

  const deploymentStatus =
    computedContractAddress === deployedContractAddress
      ? "Deployed Successfully"
      : false;

  console.log(name, deploymentStatus);

  if (!deploymentStatus) {
    console.log(`Invalid ${name} Deployment`);
  }

  return "0x";
};

/**
 * deploy a contract using our EIP-2470 deployer.
 * The delpoyer is deployed (unless it is already deployed)
 * NOTE: this transaction will fail if already deployed. use getDeployedAddress to check it first.
 * @param initCode
 * @param salt
 */
export const deploy = async (
  provider: Provider,
  initCode: string,
  salt: BigNumberish,
  gasLimit?: BigNumberish | "estimate"
): Promise<string> => {
  // await this.deployFactory();

  const addr = getDeployedAddress(initCode, salt);
  const isDeployed = await isContract(addr, provider);
  if (isDeployed) {
    return addr;
  }

  const factory = new Contract(
    FACTORY_ADDRESS,
    ["function deploy(bytes _initCode, bytes32 _salt) returns(address)"],
    (provider as ethers.providers.JsonRpcProvider).getSigner()
  );
  const saltBytes32 = hexZeroPad(hexlify(salt), 32);
  if (gasLimit === "estimate") {
    gasLimit = await factory.deploy(initCode, saltBytes32, options);
  }

  // manual estimation (its bit larger: we don't know actual deployed code size)
  gasLimit =
    gasLimit ??
    arrayify(initCode)
      .map((x) => (x === 0 ? 4 : 16))
      .reduce((sum, x) => sum + x) +
      (200 * initCode.length) / 2 + // actual is usually somewhat smaller (only deposited code, not entire constructor)
      6 * Math.ceil(initCode.length / 64) + // hash price. very minor compared to deposit costs
      32000 +
      21000;
  console.log("gasLimit computed: ", gasLimit);
  const ret = await factory.deploy(initCode, saltBytes32, options);
  await ret.wait(2);
  return addr;
};

// deploy the EIP2470 factory, if not already deployed.
// (note that it requires to have a "signer" with 0.0247 eth, to fund the deployer's deployment
export const deployFactory = async (provider: Provider): Promise<void> => {
  const signer = (provider as ethers.providers.JsonRpcProvider).getSigner();
  // Return if it's already deployed
  const txn = await (signer ?? signer).sendTransaction({
    to: factoryDeployer,
    value: BigNumber.from(factoryDeploymentFee),
  });
  await txn.wait(2);
  const tx = await provider.sendTransaction(factoryTx);
  await tx.wait();
  // if still not deployed then throw / inform
};

export const numberToUint256 = (value: number) => {
  const hex = value.toString(16);
  return `0x${"0".repeat(64 - hex.length)}${hex}`;
};

export const saltToHex = (salt: string | number) => {
  salt = salt.toString();
  if (ethers.utils.isHexString(salt)) {
    return salt;
  }

  return ethers.utils.id(salt);
};

export const SALT = saltToHex("SCW_V2");

export const encodeParam = (dataType: any, data: any) => {
  const abiCoder = ethers.utils.defaultAbiCoder;
  return abiCoder.encode([dataType], [data]);
};

export const encodeParams = (dataTypes: any[], data: any[]) => {
  const abiCoder = ethers.utils.defaultAbiCoder;
  const encodedData = abiCoder.encode(dataTypes, data);
  console.log("encodedData ", encodedData);

  return encodedData;
};

export const isContract = async (address: string, provider: Provider) => {
  const code = await provider.getCode(address);
  return code.slice(2).length > 0;
};

export const parseEvents = (
  receipt: TransactionReceipt,
  contractInterface: Interface,
  eventName: string
) =>
  receipt.logs
    .map((log) => contractInterface.parseLog(log))
    .filter((log) => log.name === eventName);
