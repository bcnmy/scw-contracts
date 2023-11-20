import { BigNumber, BytesLike, Contract, Signer } from "ethers";
import { ethers } from "hardhat";
import { EntryPoint } from "../../typechain-types";
import { UserOperation } from "./userOperation";
import { fillAndSign, makeEcdsaModuleUserOp, packUserOp } from "./userOp";
import {
  hexZeroPad,
  hexConcat,
  defaultAbiCoder,
  solidityPack,
  solidityKeccak256,
} from "ethers/lib/utils";
import MerkleTree from "merkletreejs";
import { keccak256 } from "ethereumjs-util";
import { callDataCost } from "./testUtils";

export interface SessionKeyParams {
  sessionKeyData: string;
  leafData: string;
}

export async function makeEcdsaSessionKeySignedBatchUserOp(
  functionName: string,
  functionParams: any,
  userOpSender: string,
  sessionKey: Signer,
  entryPoint: EntryPoint,
  sessionKeyManagerAddress: string,
  sessionData: any[],
  sessionRouterAddress: string,
  options?: {
    preVerificationGas?: number;
  }
): Promise<UserOperation> {
  const SmartAccount = await ethers.getContractFactory("SmartAccount");

  const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
    functionName,
    functionParams
  );

  const userOp = await fillAndSign(
    {
      sender: userOpSender,
      callData: txnDataAA1,
      ...options,
    },
    sessionKey,
    entryPoint,
    "nonce"
  );

  const userOpHash = await entryPoint.getUserOpHash(userOp);
  const signatureOverUserOpHash = await sessionKey.signMessage(
    ethers.utils.arrayify(userOpHash)
  );

  const paddedSig = defaultAbiCoder.encode(
    [
      "address",
      "tuple(uint48,uint48,address,bytes,bytes32[],bytes)[]",
      "bytes",
    ],
    [sessionKeyManagerAddress, sessionData, signatureOverUserOpHash]
  );

  const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
    ["bytes", "address"],
    [paddedSig, sessionRouterAddress]
  );
  userOp.signature = signatureWithModuleAddress;

  return userOp;
}

export async function makeEcdsaSessionKeySignedUserOp(
  functionName: string,
  functionParams: any,
  userOpSender: string,
  sessionKey: Signer,
  entryPoint: EntryPoint,
  sessionKeyManagerAddress: string,
  validUntil: number,
  validAfter: number,
  sessionValidationModuleAddress: string,
  sessionKeyParamsData: BytesLike,
  merkleProof: any,
  options?: {
    preVerificationGas?: number;
  }
): Promise<UserOperation> {
  const SmartAccount = await ethers.getContractFactory("SmartAccount");

  const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
    functionName,
    functionParams
  );

  const userOp = await fillAndSign(
    {
      sender: userOpSender,
      callData: txnDataAA1,
      ...options,
    },
    sessionKey,
    entryPoint,
    "nonce",
    true
  );

  const paddedSig = defaultAbiCoder.encode(
    // validUntil, validAfter, sessionVerificationModule address, validationData, merkleProof, signature
    ["uint48", "uint48", "address", "bytes", "bytes32[]", "bytes"],
    [
      validUntil,
      validAfter,
      sessionValidationModuleAddress,
      sessionKeyParamsData,
      merkleProof,
      userOp.signature,
    ]
  );

  const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
    ["bytes", "address"],
    [paddedSig, sessionKeyManagerAddress]
  );
  userOp.signature = signatureWithModuleAddress;

  return userOp;
}

export async function makeStatelessEcdsaSessionKeySignedUserOp(
  functionName: string,
  functionParams: any,
  userOpSender: string,
  sessionKey: Signer,
  entryPoint: EntryPoint,
  sessionKeyManagerAddress: string,
  validUntil: number,
  validAfter: number,
  sessionKeyIndex: number,
  sessionValidationModuleAddress: string,
  sessionKeyParamsData: BytesLike,
  sessionEnableData: BytesLike,
  erc1271EnableSignature: BytesLike,
  options?: {
    preVerificationGas?: number;
  }
): Promise<UserOperation> {
  const SmartAccount = await ethers.getContractFactory("SmartAccount");

  const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
    functionName,
    functionParams
  );

  const userOp = await fillAndSign(
    {
      sender: userOpSender,
      callData: txnDataAA1,
      ...options,
    },
    sessionKey,
    entryPoint,
    "nonce",
    true
  );

  const paddedSig = defaultAbiCoder.encode(
    [
      "uint48",
      "uint48",
      "uint256",
      "address",
      "bytes",
      "bytes",
      "bytes",
      "bytes",
    ],
    [
      validUntil,
      validAfter,
      sessionKeyIndex,
      sessionValidationModuleAddress,
      sessionKeyParamsData,
      sessionEnableData,
      erc1271EnableSignature,
      userOp.signature,
    ]
  );

  const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
    ["bytes", "address"],
    [paddedSig, sessionKeyManagerAddress]
  );
  userOp.signature = signatureWithModuleAddress;

  return userOp;
}

export async function makeHybridEcdsaSessionKeyEnableSignedUserOp(
  functionName: string,
  functionParams: any,
  userOpSender: string,
  sessionKey: Signer,
  entryPoint: EntryPoint,
  sessionKeyManagerAddress: string,
  validUntil: number,
  validAfter: number,
  sessionKeyIndex: number,
  sessionValidationModuleAddress: string,
  sessionKeyParamsData: BytesLike,
  sessionEnableData: BytesLike,
  erc1271EnableSignature: BytesLike,
  options?: {
    preVerificationGas?: number;
  }
): Promise<UserOperation> {
  const SmartAccount = await ethers.getContractFactory("SmartAccount");

  const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
    functionName,
    functionParams
  );

  const userOp = await fillAndSign(
    {
      sender: userOpSender,
      callData: txnDataAA1,
      ...options,
    },
    sessionKey,
    entryPoint,
    "nonce",
    true
  );

  const paddedSig = defaultAbiCoder.encode(
    [
      "uint256",
      "uint48",
      "uint48",
      "uint256",
      "address",
      "bytes",
      "bytes",
      "bytes",
      "bytes",
    ],
    [
      1,
      validUntil,
      validAfter,
      sessionKeyIndex,
      sessionValidationModuleAddress,
      sessionKeyParamsData,
      sessionEnableData,
      erc1271EnableSignature,
      userOp.signature,
    ]
  );

  const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
    ["bytes", "address"],
    [paddedSig, sessionKeyManagerAddress]
  );
  userOp.signature = signatureWithModuleAddress;

  return userOp;
}

export async function makeStatefullEcdsaSessionKeySignedUserOp(
  functionName: string,
  functionParams: any,
  userOpSender: string,
  sessionKey: Signer,
  entryPoint: EntryPoint,
  sessionKeyManagerAddress: string,
  validUntil: number,
  validAfter: number,
  sessionValidationModuleAddress: string,
  sessionKeyParamsData: BytesLike,
  options?: {
    preVerificationGas?: number;
  }
): Promise<UserOperation> {
  const SmartAccount = await ethers.getContractFactory("SmartAccount");

  const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
    functionName,
    functionParams
  );

  const userOp = await fillAndSign(
    {
      sender: userOpSender,
      callData: txnDataAA1,
      ...options,
    },
    sessionKey,
    entryPoint,
    "nonce",
    true
  );

  const sessionDataDigest = solidityKeccak256(
    ["uint48", "uint48", "address", "bytes"],
    [
      validUntil,
      validAfter,
      sessionValidationModuleAddress,
      sessionKeyParamsData,
    ]
  );
  const moduleSignature = ethers.utils.defaultAbiCoder.encode(
    ["bytes32", "bytes"],
    [sessionDataDigest, userOp.signature]
  );

  const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
    ["bytes", "address"],
    [moduleSignature, sessionKeyManagerAddress]
  );
  userOp.signature = signatureWithModuleAddress;

  return userOp;
}

export async function makeHybridEcdsaPreEnabledSessionKeySignedUserOp(
  functionName: string,
  functionParams: any,
  userOpSender: string,
  sessionKey: Signer,
  entryPoint: EntryPoint,
  sessionKeyManagerAddress: string,
  validUntil: number,
  validAfter: number,
  sessionValidationModuleAddress: string,
  sessionKeyParamsData: BytesLike,
  options?: {
    preVerificationGas?: number;
  }
): Promise<UserOperation> {
  const SmartAccount = await ethers.getContractFactory("SmartAccount");

  const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
    functionName,
    functionParams
  );

  const userOp = await fillAndSign(
    {
      sender: userOpSender,
      callData: txnDataAA1,
      ...options,
    },
    sessionKey,
    entryPoint,
    "nonce",
    true
  );

  const sessionDataDigest = solidityKeccak256(
    ["uint48", "uint48", "address", "bytes"],
    [
      validUntil,
      validAfter,
      sessionValidationModuleAddress,
      sessionKeyParamsData,
    ]
  );
  const moduleSignature = ethers.utils.defaultAbiCoder.encode(
    ["uint256", "bytes32", "bytes"],
    [0, sessionDataDigest, userOp.signature]
  );

  const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
    ["bytes", "address"],
    [moduleSignature, sessionKeyManagerAddress]
  );
  userOp.signature = signatureWithModuleAddress;

  return userOp;
}

export async function enableNewTreeForSmartAccountViaEcdsa(
  leaves: BytesLike[],
  sessionKeyManager: Contract,
  SmartAccountAddress: string,
  smartAccountOwner: Signer,
  entryPoint: EntryPoint,
  ecdsaModuleAddress: string
): Promise<MerkleTree> {
  const merkleTree = new MerkleTree(leaves, keccak256, {
    sortPairs: true,
    hashLeaves: false,
  });
  const addMerkleRootUserOp = await makeEcdsaModuleUserOp(
    "execute_ncC",
    [
      sessionKeyManager.address,
      ethers.utils.parseEther("0"),
      sessionKeyManager.interface.encodeFunctionData("setMerkleRoot", [
        merkleTree.getHexRoot(),
      ]),
    ],
    SmartAccountAddress,
    smartAccountOwner,
    entryPoint,
    ecdsaModuleAddress
  );
  const tx = await entryPoint.handleOps(
    [addMerkleRootUserOp],
    await smartAccountOwner.getAddress()
  );
  const { gasUsed } = await tx.wait();

  console.log("gasUsed in new merkle tree user op", gasUsed.toString());

  return merkleTree;
}

export async function addLeavesForSmartAccountViaEcdsa(
  merkleTree: MerkleTree,
  newLeaves: any[],
  sessionKeyManager: Contract,
  SmartAccountAddress: string,
  smartAccountOwner: Signer,
  entryPoint: EntryPoint,
  ecdsaModuleAddress: string
): Promise<MerkleTree> {
  // rebuilding the tree instead of doing .addLeaves to make sure tree is always sorted
  // as it is always considered as sorted in OZ Merkle Tree implementation
  const leaves = merkleTree.getHexLeaves();
  const sumLeaves = leaves.concat(newLeaves);
  const newMerkleTree = new MerkleTree(sumLeaves, keccak256, {
    sortPairs: true,
    hashLeaves: false,
  });

  const addMerkleRootUserOp = await makeEcdsaModuleUserOp(
    "execute_ncC",
    [
      sessionKeyManager.address,
      ethers.utils.parseEther("0"),
      sessionKeyManager.interface.encodeFunctionData("setMerkleRoot", [
        newMerkleTree.getHexRoot(),
      ]),
    ],
    SmartAccountAddress,
    smartAccountOwner,
    entryPoint,
    ecdsaModuleAddress
  );
  const tx = await entryPoint.handleOps(
    [addMerkleRootUserOp],
    await smartAccountOwner.getAddress()
  );
  const { gasUsed } = await tx.wait();

  const calldataCost = callDataCost(packUserOp(addMerkleRootUserOp, false));
  console.log("Merkle Tree Update root calldata cost", calldataCost);
  console.log("gasUsed in update merkle tree user op", gasUsed.toString());

  return newMerkleTree;
}

export async function getERC20SessionKeyParams(
  sessionKey: string,
  erc20TokenAddress: string,
  receiverAddress: string,
  maxAmountToTransfer: BigNumber,
  validUntil: number,
  validAfter: number,
  sessionValidationModuleAddress: string
): Promise<SessionKeyParams> {
  const sessionKeyData = defaultAbiCoder.encode(
    ["address", "address", "address", "uint256"],
    [
      sessionKey,
      erc20TokenAddress,
      receiverAddress,
      maxAmountToTransfer.toHexString(),
    ]
  );

  const leafData = hexConcat([
    hexZeroPad(ethers.utils.hexlify(validUntil), 6),
    hexZeroPad(ethers.utils.hexlify(validAfter), 6),
    hexZeroPad(sessionValidationModuleAddress, 20),
    sessionKeyData,
  ]);

  const params: SessionKeyParams = {
    sessionKeyData: sessionKeyData,
    leafData: leafData,
  };
  return params;
}

export function makeSessionEnableData(
  chainIds: number[],
  sessionData: BytesLike[]
): BytesLike {
  if (chainIds.length !== sessionData.length) {
    throw new Error("chainIds and sessionData must be of same length");
  }

  return solidityPack(
    [
      "uint8",
      ...(new Array(chainIds.length).fill(0).map(() => "uint64") as string[]),
      ...(new Array(sessionData.length)
        .fill(0)
        .map(() => "bytes32") as string[]),
    ],
    [
      chainIds.length,
      ...chainIds,
      ...sessionData.map((data) => ethers.utils.keccak256(data)),
    ]
  );
}
