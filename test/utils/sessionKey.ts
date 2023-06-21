import { BigNumber, BytesLike, Contract, Signer, Wallet } from "ethers";
import { ethers } from "hardhat";
import { EntryPoint } from "../../typechain";
import { UserOperation } from "./userOperation";
import { fillAndSign, makeEcdsaModuleUserOp } from "./userOp";
import { hexZeroPad, hexConcat, defaultAbiCoder } from "ethers/lib/utils";
import MerkleTree from "merkletreejs";
import {keccak256} from "ethereumjs-util";

export interface SessionKeyParams {
  sessionKeyData: string;
  leafData: string;
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
  merkleProof: any
) : Promise<UserOperation> {
  const SmartAccount = await ethers.getContractFactory("SmartAccount");
  
  const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
    functionName,
    functionParams
  );
  
  const userOp = await fillAndSign(
    {
      sender: userOpSender,
      callData: txnDataAA1
    },
    sessionKey,
    entryPoint,
    'nonce'
  );

  const paddedSig = defaultAbiCoder.encode(
    //validUntil, validAfter, sessionVerificationModule address, validationData, merkleProof, signature
    ["uint48", "uint48", "address", "bytes", "bytes32[]", "bytes"],
    [ 
      validUntil, 
      validAfter, 
      sessionValidationModuleAddress, 
      sessionKeyParamsData, 
      merkleProof, 
      userOp.signature
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
) : Promise<MerkleTree> {

  const merkleTree = new MerkleTree(
    leaves,
    keccak256,
    { sortPairs: false, hashLeaves: false }
  );
  let addMerkleRootUserOp = await makeEcdsaModuleUserOp(
    "executeCall",
    [
      sessionKeyManager.address,
      ethers.utils.parseEther("0"),
      sessionKeyManager.interface.encodeFunctionData("setMerkleRoot", [merkleTree.getHexRoot()]),
    ],
    SmartAccountAddress,
    smartAccountOwner,
    entryPoint,
    ecdsaModuleAddress
  );
  const tx = await entryPoint.handleOps([addMerkleRootUserOp], await smartAccountOwner.getAddress());
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
) : Promise<MerkleTree> {
  
  merkleTree.addLeaves(newLeaves);
  let addMerkleRootUserOp = await makeEcdsaModuleUserOp(
    "executeCall",
    [
      sessionKeyManager.address,
      ethers.utils.parseEther("0"),
      sessionKeyManager.interface.encodeFunctionData("setMerkleRoot", [merkleTree.getHexRoot()]),
    ],
    SmartAccountAddress,
    smartAccountOwner,
    entryPoint,
    ecdsaModuleAddress
  );
  const tx = await entryPoint.handleOps([addMerkleRootUserOp], await smartAccountOwner.getAddress());
  await tx.wait();

  return merkleTree;  
}

export async function getERC20SessionKeyParams(
  sessionKey: string,
  erc20TokenAddress: string,
  receiverAddress: string,
  maxAmountToTransfer: BigNumber,
  validUntil: number,
  validAfter: number,
  sessionValidationModuleAddress: string,
) : Promise<SessionKeyParams> {

  const sessionKeyData = hexConcat([
    hexZeroPad(sessionKey, 20),
    hexZeroPad(erc20TokenAddress, 20),
    hexZeroPad(receiverAddress, 20),
    hexZeroPad(maxAmountToTransfer.toHexString(), 32)
  ]);

  const leafData = hexConcat([
    hexZeroPad(ethers.utils.hexlify(validUntil),6),
    hexZeroPad(ethers.utils.hexlify(validAfter),6),
    hexZeroPad(sessionValidationModuleAddress,20),
    sessionKeyData
  ]);
  
  const params : SessionKeyParams = {
    sessionKeyData: sessionKeyData,
    leafData: leafData
  };
  return params 
}

