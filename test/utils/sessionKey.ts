import { BigNumber, BytesLike, Contract, Signer, Wallet } from "ethers";
import { ethers } from "hardhat";
import { EntryPoint, VerifyingSingletonPaymaster } from "../../typechain";
import { UserOperation } from "./userOperation";
import { fillAndSign } from "./userOp";
import { hexZeroPad, hexConcat, defaultAbiCoder } from "ethers/lib/utils";

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
      0, 
      0, 
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

