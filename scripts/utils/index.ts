import { ethers as hardhatEthersInstance } from "hardhat";
import {
  BigNumber,
  BigNumberish,
  Contract,
  ethers,
  Signer,
  ContractFactory,
} from "ethers";
import {
  getContractAddress,
  arrayify,
  hexConcat,
  hexlify,
  hexZeroPad,
  keccak256,
  Interface,
} from "ethers/lib/utils";
import { TransactionReceipt, Provider } from "@ethersproject/providers";
import { Deployer, Deployer__factory } from "../../typechain";
export const FACTORY_ADDRESS = "0x32cf79f3a7cfc40551c5dd395c857e6a76bdb213";
export const FACTORY_BYTE_CODE =
  "0x6080604052348015600f57600080fd5b506004361060285760003560e01c80634af63f0214602d575b600080fd5b60cf60048036036040811015604157600080fd5b810190602081018135640100000000811115605b57600080fd5b820183602082011115606c57600080fd5b80359060200191846001830284011164010000000083111715608d57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929550509135925060eb915050565b604080516001600160a01b039092168252519081900360200190f35b6000818351602085016000f5939250505056fea26469706673582212206b44f8a82cb6b156bfcc3dc6aadd6df4eefd204bc928a4397fd15dacf6d5320564736f6c63430006020033";
export const factoryDeployer = "0x7DF9f9522BbBbA802C868124F8ADD15f22c51Aed";
export const factoryTx =
  "0xf9049280846cbf5ae3832dc6c08080b90440608060405234801561001057600080fd5b50610420806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063bb34534c1461003b578063cdcb760a1461006a575b600080fd5b61004e61004936600461031a565b61007f565b6040516001600160a01b03909116815260200160405180910390f35b61007d610078366004610333565b610090565b005b600061008a8261010f565b92915050565b60006100d28484848080601f0160208091040260200160405190810160405280939291908181526020018383808284376000920191909152506101e692505050565b6040519091506001600160a01b038216907f8ffcdc15a283d706d38281f500270d8b5a656918f555de0913d7455e3e6bc1bf90600090a250505050565b600080610190836040516001600160f81b031960208201526bffffffffffffffffffffffff193060601b166021820152603581018290527f21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f605582015260009060750160408051601f19818403018152919052805160209091012092915050565b6040516135a560f21b60208201526bffffffffffffffffffffffff19606083901b166022820152600160f81b603682015290915060370160408051601f1981840301815291905280516020909101209392505050565b60006101f4838360006101fb565b9392505050565b60408051808201909152601081526f67363d3d37363d34f03d5260086018f360801b602082015260009061022e8561010f565b9150813b156102505760405163cd43efa160e01b815260040160405180910390fd5b6000858251602084016000f590506001600160a01b0381166102855760405163bbd2fe8760e01b815260040160405180910390fd5b6000816001600160a01b031685876040516102a091906103af565b60006040518083038185875af1925050503d80600081146102dd576040519150601f19603f3d011682016040523d82523d6000602084013e6102e2565b606091505b505090508015806102f25750833b155b15610310576040516353de54b960e01b815260040160405180910390fd5b5050509392505050565b60006020828403121561032c57600080fd5b5035919050565b60008060006040848603121561034857600080fd5b83359250602084013567ffffffffffffffff8082111561036757600080fd5b818601915086601f83011261037b57600080fd5b81358181111561038a57600080fd5b87602082850101111561039c57600080fd5b6020830194508093505050509250925092565b6000825160005b818110156103d057602081860181015185830152016103b6565b818111156103df576000828501525b50919091019291505056fea2646970667358221220097a650c0aca106bea47e4e2fa6ac5e54aab2fe4cae0e2bdd2320961c37bf97264736f6c634300080c00332ea0d20ca1cef935b174f1fb627e3f773eb0bf037bd8ecf3a04d4fbc03e502b683f1a002d55db776576596eab1a4e0d7091d2e904abc038ae06a6738fdfa4a1aa395e7";
export const factoryTxHash =
  "0x803351deb6d745e91545a6a3e1c0ea3e9a6a02a1a4193b70edfcd2f40f71a01c";

const factoryDeploymentFee = (0.0247 * 1e18).toString(); // 0.0247
const options = { gasLimit: 7000000 /*, gasPrice: 70000000000 */ };

export enum DEPLOYMENT_SALTS {
  CALLBACK_HANDLER = "CALLBACK_HANDLER_V21",
  DECODER = "DECODER_V21",
  ENTRY_POINT = "ENTRY_POINT_V21",
  GAS_ESTIMATOR = "GAS_ESTIMATOR_V21",
  MULTI_SEND = "MULTI_SEND_V21",
  MULTI_SEND_CALLONLY = "MULTI_SEND_CALLONLY_V21",
  WALLET_FACTORY = "WALLET_FACTORY_V21",
  WALLET_IMP = "WALLET_IMP_V21",
  SINGELTON_PAYMASTER = "SINGELTON_PAYMASTER_V21",
}

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

export const getDeployerInstance = async (
  provider?: Provider
): Promise<Deployer> => {
  // const metaDeployerPrivateKey = process.env.FACTORY_DEPlOYER_PRIVATE_KEY;
  // if (!metaDeployerPrivateKey) {
  //   throw new Error("FACTORY_DEPLOYER_PRIVATE_KEY not set");
  // }
  // const metaDeployer = new ethers.Wallet(
  //   metaDeployerPrivateKey,
  //   hardhatEthersInstance.provider
  // );
  // const deployerAddress = getContractAddress({
  //   from: metaDeployer.address,
  //   nonce: 0,
  // });

  // const provider = hardhatEthersInstance.provider;
  const [signer] = await hardhatEthersInstance.getSigners();
  console.log(await signer.getAddress());

  // const chainId = (await provider.getNetwork()).chainId;
  // console.log(`Checking deployer ${deployerAddress} on chain ${chainId}...`);
  // const code = await provider.getCode(deployerAddress);
  // if (code === "0x") {
  //   console.log("Deployer not deployed, deploying...");
  //   const metaDeployerPrivateKey = process.env.FACTORY_DEPlOYER_PRIVATE_KEY;
  //   if (!metaDeployerPrivateKey) {
  //     throw new Error("FACTORY_DEPlOYER_PRIVATE_KEY not set");
  //   }
  //   const metaDeployerSigner = new ethers.Wallet(
  //     metaDeployerPrivateKey,
  //     provider
  //   );
  //   const deployer = await new Deployer__factory(metaDeployerSigner).deploy();
  //   await deployer.deployed();
  //   console.log(`Deployer deployed at ${deployer.address} on chain ${chainId}`);
  // }
  //  else {
  //   console.log(`Deployer already deployed on chain ${chainId}`);
  // }
  if (provider) await deployFactory(provider);

  return Deployer__factory.connect(FACTORY_ADDRESS, signer);
};

export const deployContract = async (
  name: string,
  computedContractAddress: string,
  salt: string,
  contractByteCode: string,
  deployerInstance: Deployer
): Promise<string> => {
  const { hash, wait } = await deployerInstance.deploy(salt, contractByteCode);

  console.log(`Submitted transaction ${hash} for deployment`);

  const { status, logs, blockNumber } = await wait(2);

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
    console.log(`Invalid ${name} Handler Deployment`);
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
  try {
    // if (!(await isContract(FACTORY_ADDRESS, provider))) {
      console.log("factory not deployed");
      console.log("Topping Up deployer account");
      const signer = (provider as ethers.providers.JsonRpcProvider).getSigner();
      console.log('signer ', await signer.getAddress());
      
      // Return if it's already deployed
      const chainId = (await provider.getNetwork()).chainId;
      const deploymentFeeByNetwork = getFeeByNetwork(chainId);
      console.log('deploymentFeeByNetwork ', deploymentFeeByNetwork);
      
      const deployerBalance = await provider.getBalance(factoryDeployer);
      console.log('Deployer Balance ', deployerBalance);
      
      if (deployerBalance.lt(deploymentFeeByNetwork)) {
        console.log("Topping Up Deployment Fee");
        const topUpDeploymentFee = deploymentFeeByNetwork.sub(deployerBalance);
        console.log('topUpDeploymentFee ', topUpDeploymentFee);
        
        const txn = await (signer ?? signer).sendTransaction({
          to: factoryDeployer,
          value: BigNumber.from(topUpDeploymentFee),
        });
        await txn.wait(2);
      }
      console.log("Deploying Factory");      
      const tx = await provider.sendTransaction(factoryTx);
      await tx.wait();
    // }
    // if still not deployed then throw / inform
  } catch (e) {
    console.log(e.message);
    throw e;
  }
};

export enum ChainId {
  // Ethereum
  MAINNET = 1,
  GOERLI = 5,
  POLYGON_MUMBAI = 80001,
  POLYGON_MAINNET = 137,
  BSC_TESTNET = 97,
  BSC_MAINNET = 56,
  GANACHE = 1337, //Temp
}

const getFeeByNetwork = (networkId: number) => {
  console.log('network id', networkId);
  
  switch (networkId) {
    case ChainId.GOERLI:
      return BigNumber.from((0.1 * 1e18).toString())
    case ChainId.POLYGON_MUMBAI:
      return BigNumber.from((0.1 * 1e18).toString())
    default:
      return BigNumber.from((.0003 * 1e18).toString())
  }
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
  console.log("isContract code is ", code);
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
