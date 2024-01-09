import { BigNumber, BytesLike, Contract, Signer } from "ethers";
import { ethers } from "hardhat";
import { EntryPoint } from "../../typechain-types";
import { UserOperation } from "./userOperation";
import { fillAndSign, makeEcdsaModuleUserOp } from "./userOp";
import { hexZeroPad, hexConcat, defaultAbiCoder } from "ethers/lib/utils";
import MerkleTree from "merkletreejs";
import { keccak256 } from "ethereumjs-util";

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
  await tx.wait();

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
  await tx.wait();

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

export interface Rule {
  offset: number;
  condition: number;
  referenceValue: string | BytesLike;
}

export interface Permission {
  destContract: string;
  functionSelector: string;
  valueLimit: BigNumber;
  rules: Rule[];
}

export async function getABISessionKeyParams(
  sessionKey: string,
  permission: Permission,
  validUntil: number,
  validAfter: number,
  sessionValidationModuleAddress: string
): Promise<SessionKeyParams> {
  /* let sessionKeyData = defaultAbiCoder.encode(
    [
      "tuple(address, bytes4, uint256, tuple(uint256, bytes32, uint8)[])",
    ],
    [permission]
  ); */

  let sessionKeyData = hexConcat([
    sessionKey,
    permission.destContract,
    permission.functionSelector,
    hexZeroPad(permission.valueLimit.toHexString(), 16),
    hexZeroPad(ethers.utils.hexlify(permission.rules.length), 2), // this can't be more 2**11 (see below), so uint16 (2 bytes) is enough
  ]);

  for (let i = 0; i < permission.rules.length; i++) {
    sessionKeyData = hexConcat([
      sessionKeyData,
      hexZeroPad(ethers.utils.hexlify(permission.rules[i].offset), 2), // offset is uint16, so there can't be more than 2**16/32 args = 2**11
      hexZeroPad(ethers.utils.hexlify(permission.rules[i].condition), 1), // uint8
      permission.rules[i].referenceValue,
    ]);
  }

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
