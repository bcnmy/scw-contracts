import { BigNumber, BytesLike, Contract, Signer } from "ethers";
import { ethers } from "hardhat";
import { EntryPoint, SmartAccount } from "../../typechain";
import { UserOperation } from "./userOperation";
import { fillAndSign, makeEcdsaModuleUserOp, getUserOpHash, fillUserOp } from "./userOp";
import { hexZeroPad, hexConcat, defaultAbiCoder, arrayify } from "ethers/lib/utils";
import MerkleTree from "merkletreejs";
import { keccak256 } from "ethereumjs-util";

export async function makeMultiSignedUserOpWithGuardiansList(
  functionName: string,
  functionParams: any,
  userOpSender: string,
  userOpSigners: Signer[],
  controlMessage: string,
  entryPoint: EntryPoint,
  moduleAddress: string,
  options?: {
    preVerificationGas?: number;
  }
): Promise<UserOperation> {
  const SmartAccount = await ethers.getContractFactory("SmartAccount");

  const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
    functionName,
    functionParams
  );

  const provider = entryPoint.provider;
  const op2 = await fillUserOp(
    {
      sender: userOpSender,
      callData: txnDataAA1,
      ...options,
    },
    entryPoint,
    "nonce"
  );

  const chainId = await provider!.getNetwork().then((net) => net.chainId);
  const message = arrayify(getUserOpHash(op2, entryPoint!.address, chainId));

  const messageHash = ethers.utils.id(controlMessage);
  const messageHashBytes = ethers.utils.arrayify(messageHash);

  let signatures = "0x";

  for (let i = 0; i < userOpSigners.length; i++) {
    const signer = userOpSigners[i];
    const sig = await signer.signMessage(message);
    const guardian = await signer.signMessage(messageHashBytes);
    signatures = signatures + sig.slice(2) + guardian.slice(2);
  }

  // add validator module address to the signature
  const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
    ["bytes", "address"],
    [signatures, moduleAddress]
  );

  op2.signature = signatureWithModuleAddress;
  return op2;
}

export async function makeMultisignedSubmitRecoveryRequestUserOp(
  recoveryMethodName: string,
  recoveryMethodParams: any[],
  ownershipModule: Contract,
  userOpSender: string,
  userOpSigners: Signer[],
  controlMessage: string,
  entryPoint: EntryPoint,
  recoveryModule: Contract,
  options?: {
    preVerificationGas?: number;
  }
): Promise<UserOperation> {

  const SmartAccount = await ethers.getContractFactory(
    "SmartAccount"
  );

  const recoveryRequestCallData = SmartAccount.interface.encodeFunctionData(
    "execute",
    [
      ownershipModule.address,
      ethers.utils.parseEther("0"),
      ownershipModule.interface.encodeFunctionData(recoveryMethodName, recoveryMethodParams),
    ]
  );
  
  const userOp = await makeMultiSignedUserOpWithGuardiansList(
    "execute",
    [
      recoveryModule.address,
      ethers.utils.parseEther("0"),
      recoveryModule.interface.encodeFunctionData(
        "submitRecoveryRequest",
        [recoveryRequestCallData]
      ),
    ],
    userOpSender,
    userOpSigners, // order is important
    controlMessage,
    entryPoint,
    recoveryModule.address,
    {
      ...options
    }
  );

  return userOp;
}
