import { ethers } from "hardhat";
import {
  Contract,
  Wallet,
  utils,
  BigNumber,
  BigNumberish,
  Signer,
  PopulatedTransaction,
} from "ethers";
import { TypedDataSigner } from "@ethersproject/abstract-signer";
import { AddressZero } from "@ethersproject/constants";

export const ACCOUNT_ABSTRACTION_FLOW = 0;
export const EOA_CONTROLLED_FLOW = 1;

export const EIP_DOMAIN = {
  EIP712Domain: [
    { type: "uint256", name: "chainId" },
    { type: "address", name: "verifyingContract" },
  ],
};

export const EIP712_ACCOUNT_TX_TYPE = {
  // "AccountTx(address to,uint256 value,bytes data,uint8 operation,uint256 targetTxGas,uint256 batchId,uint256 baseGas,uint256 gasPrice,uint256 tokenGasPriceFactor,address gasToken,address refundReceiver)"
  AccountTx: [
    { type: "address", name: "to" },
    { type: "uint256", name: "value" },
    { type: "bytes", name: "data" },
    { type: "uint8", name: "operation" },
    { type: "uint256", name: "targetTxGas" },
    { type: "uint256", name: "batchId" },
    { type: "uint256", name: "baseGas" },
    { type: "uint256", name: "gasPrice" },
    { type: "uint256", name: "tokenGasPriceFactor" },
    { type: "address", name: "gasToken" },
    { type: "address", name: "refundReceiver" },
    { type: "uint256", name: "nonce" },
  ],
};

export const EIP712_SAFE_MESSAGE_TYPE = {
  // "SafeMessage(bytes message)"
  SafeMessage: [{ type: "bytes", name: "message" }],
};

export interface MetaTransaction {
  to: string;
  value: string | number | BigNumber;
  data: string;
  operation: number;
}

export interface SafeTransaction2D extends MetaTransaction {
  targetTxGas: string | number;
  batchId: string | number;
  baseGas: string | number;
  gasPrice: string | number;
  tokenGasPriceFactor: string | number;
  gasToken: string;
  refundReceiver: string;
  nonce: string | number;
}

export interface Transaction {
  to: string;
  value: string | number | BigNumber;
  data: string;
  operation: number;
  targetTxGas: string | number;
}

export interface FeeRefund {
  baseGas: string | number;
  gasPrice: string | number;
  tokenGasPriceFactor: string | number;
  gasToken: string;
  refundReceiver: string;
}

export interface WalletTransaction {
  _tx: Transaction;
  refundInfo: FeeRefund;
  batchId: number;
  nonce: string | number;
}

export interface SafeSignature {
  signer: string;
  data: string;
}

export const calculateSafeDomainSeparator = (
  safe: Contract,
  chainId: BigNumberish
): string => {
  return utils._TypedDataEncoder.hashDomain({
    verifyingContract: safe.address,
    chainId,
  });
};

export const preimageSafeTransactionHash = (
  safe: Contract,
  safeTx: SafeTransaction2D,
  chainId: BigNumberish
): string => {
  return utils._TypedDataEncoder.encode(
    { verifyingContract: safe.address, chainId },
    EIP712_ACCOUNT_TX_TYPE,
    safeTx
  );
};

export const calculateSafeTransactionHash = (
  safe: Contract,
  safeTx: SafeTransaction2D,
  chainId: BigNumberish
): string => {
  return utils._TypedDataEncoder.hash(
    { verifyingContract: safe.address, chainId },
    EIP712_ACCOUNT_TX_TYPE,
    safeTx
  );
};

export const calculateSafeMessageHash = (
  safe: Contract,
  message: string,
  chainId: BigNumberish
): string => {
  return utils._TypedDataEncoder.hash(
    { verifyingContract: safe.address, chainId },
    EIP712_SAFE_MESSAGE_TYPE,
    { message }
  );
};

export const safeApproveHash = async (
  signer: Signer,
  safe: Contract,
  safeTx: SafeTransaction2D,
  skipOnChainApproval?: boolean
): Promise<SafeSignature> => {
  if (!skipOnChainApproval) {
    if (!signer.provider)
      throw Error("Provider required for on-chain approval");
    const chainId = (await signer.provider.getNetwork()).chainId;
    const typedDataHash = utils.arrayify(
      calculateSafeTransactionHash(safe, safeTx, chainId)
    );
    const signerSafe = safe.connect(signer);
    await signerSafe.approveHash(typedDataHash);
  }
  const signerAddress = await signer.getAddress();
  return {
    signer: signerAddress,
    data:
      "0x000000000000000000000000" +
      signerAddress.slice(2) +
      "0000000000000000000000000000000000000000000000000000000000000000" +
      "01",
  };
};

export const safeSignTypedData2D = async (
  signer: Signer & TypedDataSigner,
  safe: Contract,
  safeTx: SafeTransaction2D,
  chainId?: BigNumberish
): Promise<SafeSignature> => {
  if (!chainId && !signer.provider)
    throw Error("Provider required to retrieve chainId");
  const cid = chainId || (await signer.provider!.getNetwork()).chainId;
  const signerAddress = await signer.getAddress();
  return {
    signer: signerAddress,
    data: await signer._signTypedData(
      { verifyingContract: safe.address, chainId: cid },
      EIP712_ACCOUNT_TX_TYPE,
      safeTx
    ),
  };
};

export const signHash = async (
  signer: Signer,
  hash: string
): Promise<SafeSignature> => {
  const typedDataHash = utils.arrayify(hash);
  const signerAddress = await signer.getAddress();
  return {
    signer: signerAddress,
    data: (await signer.signMessage(typedDataHash))
      .replace(/1b$/, "1f")
      .replace(/1c$/, "20"),
  };
};

export const safeSignMessage = async (
  signer: Signer,
  safe: Contract,
  safeTx: SafeTransaction2D,
  chainId?: BigNumberish
): Promise<SafeSignature> => {
  const cid = chainId || (await signer.provider!.getNetwork()).chainId;
  return signHash(signer, calculateSafeTransactionHash(safe, safeTx, cid));
};

export const buildSignatureBytes = (signatures: SafeSignature[]): string => {
  signatures.sort((left, right) =>
    left.signer.toLowerCase().localeCompare(right.signer.toLowerCase())
  );
  let signatureBytes = "0x";
  for (const sig of signatures) {
    signatureBytes += sig.data.slice(2);
  }
  return signatureBytes;
};

export const buildContractSignature = (
  signer: string,
  data: string
): string => {
  const SIGNATURE_LENGTH_BYTES = 65;

  let signatureBytes = "0x";
  let dynamicBytes = "";

  /* 
              A contract signature has a static part of 65 bytes and the dynamic part that needs to be appended at the end of 
              end signature bytes.
              The signature format is
              Signature type == 0
              Constant part: 65 bytes
              {32-bytes signature verifier}{32-bytes dynamic data position}{1-byte signature type}
              Dynamic part (solidity bytes): 32 bytes + signature data length
              {32-bytes signature length}{bytes signature data}
          */
  const dynamicPartPosition = SIGNATURE_LENGTH_BYTES.toString(16).padStart(
    64,
    "0"
  );
  const dynamicPartLength = (data.slice(2).length / 2)
    .toString(16)
    .padStart(64, "0");
  const staticSignature = `${signer
    .slice(2)
    .padStart(64, "0")}${dynamicPartPosition}00`;
  const dynamicPartWithLength = `${dynamicPartLength}${data.slice(2)}`;

  signatureBytes += staticSignature;
  dynamicBytes += dynamicPartWithLength;

  return signatureBytes + dynamicBytes;
};

export const logGas = async (
  message: string,
  tx: Promise<any>,
  skip?: boolean
): Promise<any> => {
  return tx.then(async (result) => {
    const receipt = await result.wait();
    if (!skip)
      console.log(
        "           Used",
        receipt.gasUsed.toNumber(),
        `gas for >${message}<`
      );
    return result;
  });
};

export const executeTx2D = async (
  safe: Contract,
  safeTx: SafeTransaction2D,
  signatures: SafeSignature[],
  overrides?: any
): Promise<any> => {
  const signatureBytes = buildSignatureBytes(signatures);
  const transaction: Transaction = {
    to: safeTx.to,
    value: safeTx.value,
    data: safeTx.data,
    operation: safeTx.operation,
    targetTxGas: safeTx.targetTxGas,
  };
  const refundInfo: FeeRefund = {
    baseGas: safeTx.baseGas,
    gasPrice: safeTx.gasPrice,
    tokenGasPriceFactor: safeTx.tokenGasPriceFactor,
    gasToken: safeTx.gasToken,
    refundReceiver: safeTx.refundReceiver,
  };
  return safe.execTransaction(
    transaction,
    1, // hardcode to respect types
    refundInfo,
    signatureBytes,
    overrides || {}
  );
};

export const populateExecuteTx2D = async (
  safe: Contract,
  safeTx: SafeTransaction2D,
  signatures: SafeSignature[],
  overrides?: any
): Promise<PopulatedTransaction> => {
  const signatureBytes = buildSignatureBytes(signatures);
  const transaction: Transaction = {
    to: safeTx.to,
    value: safeTx.value,
    data: safeTx.data,
    operation: safeTx.operation,
    targetTxGas: safeTx.targetTxGas,
  };
  const refundInfo: FeeRefund = {
    baseGas: safeTx.baseGas,
    gasPrice: safeTx.gasPrice,
    tokenGasPriceFactor: safeTx.tokenGasPriceFactor,
    gasToken: safeTx.gasToken,
    refundReceiver: safeTx.refundReceiver,
  };
  return safe.populateTransaction.execTransaction(
    transaction,
    1, // hardcode to respect types
    refundInfo,
    signatureBytes,
    overrides || {}
  );
};

export const buildContractCall = (
  contract: Contract,
  method: string,
  params: any[],
  nonce: number,
  delegateCall?: boolean,
  overrides?: Partial<SafeTransaction2D>
): SafeTransaction2D => {
  const data = contract.interface.encodeFunctionData(method, params);
  return buildSafeTransaction2D(
    Object.assign(
      {
        to: contract.address,
        data,
        operation: delegateCall ? 1 : 0,
        nonce,
      },
      overrides
    )
  );
};

export const executeTxWithSigners2D = async (
  safe: Contract,
  tx: SafeTransaction2D,
  signers: Wallet[],
  overrides?: any
) => {
  const sigs = await Promise.all(
    signers.map((signer) => safeSignTypedData2D(signer, safe, tx))
  );
  return executeTx2D(safe, tx, sigs, overrides);
};

export const executeContractCallWithSigners2D = async (
  safe: Contract,
  contract: Contract,
  method: string,
  params: any[],
  signers: Wallet[],
  delegateCall?: boolean,
  overrides?: Partial<SafeTransaction2D>
) => {
  const tx = buildContractCall(
    contract,
    method,
    params,
    await safe.getNonce(1), // hardcode to respect types
    delegateCall,
    overrides
  );
  return executeTxWithSigners2D(safe, tx, signers);
};

export const buildSafeTransaction2D = (template: {
  to: string;
  value?: BigNumber | number | string;
  data?: string;
  operation?: number;
  targetTxGas?: number | string;
  batchId?: number | string;
  baseGas?: number | string;
  gasPrice?: number | string;
  tokenGasPriceFactor?: number | string;
  gasToken?: string;
  refundReceiver?: string;
  nonce: number;
}): SafeTransaction2D => {
  return {
    to: template.to,
    value: template.value || 0,
    data: template.data || "0x",
    operation: template.operation || 0,
    targetTxGas: template.targetTxGas || 0,
    batchId: template.batchId || 1,
    baseGas: template.baseGas || 0,
    gasPrice: template.gasPrice || 0,
    tokenGasPriceFactor: template.tokenGasPriceFactor || 1,
    gasToken: template.gasToken || AddressZero,
    refundReceiver: template.refundReceiver || AddressZero,
    nonce: template.nonce,
  };
};
