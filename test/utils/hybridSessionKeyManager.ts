import { EntryPoint } from "@account-abstraction/contracts";
import { BigNumberish, BytesLike, Signer } from "ethers";
import { UserOperation } from "./userOperation";
import {
  ISessionKeyManagerModuleHybrid,
  SessionKeyManagerHybrid,
  SmartAccount__factory,
  EcdsaOwnershipRegistryModule,
} from "../../typechain-types";
import {
  arrayify,
  defaultAbiCoder,
  hexConcat,
  solidityKeccak256,
  solidityPack,
} from "ethers/lib/utils";
import { fillAndSign } from "./userOp";

type ExecutionCallParams = {
  to: string;
  value: BigNumberish;
  calldata: BytesLike;
};

enum TRANSACTION_MODE {
  PRE_ENABLED = 0,
  ENABLE_AND_USE = 1,
}

export class HybridSKMUtils {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    protected readonly entryPoint: EntryPoint,
    protected readonly sessionKeyManager: SessionKeyManagerHybrid,
    protected readonly ecdsaModule: EcdsaOwnershipRegistryModule
  ) {}

  async sessionDigest(
    sessionData: ISessionKeyManagerModuleHybrid.SessionDataStruct
  ): Promise<string> {
    return this.sessionKeyManager.sessionDataDigest(sessionData);
  }

  async makeSessionEnableData(
    chainIds: number[],
    sessionDatas: ISessionKeyManagerModuleHybrid.SessionDataStruct[],
    smartAccountAddress: string,
    smartAccountSigner: Signer
  ): Promise<{
    sessionEnableData: BytesLike;
    sessionEnableSignature: BytesLike;
  }> {
    const sessionDataDigests = await Promise.all(
      sessionDatas.map((sessionData) => this.sessionDigest(sessionData))
    );

    const sessionEnableData = solidityPack(
      [
        "uint8",
        ...new Array(chainIds.length).fill("uint64"),
        ...new Array(sessionDataDigests.length).fill("bytes32"),
      ],
      [chainIds.length, ...chainIds, ...sessionDataDigests]
    );

    const sessionEnableDataHash = solidityKeccak256(
      [
        "uint8",
        ...new Array(chainIds.length).fill("uint64"),
        ...new Array(sessionDataDigests.length).fill("bytes32"),
      ],
      [chainIds.length, ...chainIds, ...sessionDataDigests]
    );

    const messageHashAndAddress = arrayify(
      hexConcat([sessionEnableDataHash, smartAccountAddress])
    );

    const signature = await smartAccountSigner.signMessage(
      messageHashAndAddress
    );

    const signatureWithModuleAddress = defaultAbiCoder.encode(
      ["bytes", "address"],
      [signature, this.ecdsaModule.address]
    );

    return {
      sessionEnableData,
      sessionEnableSignature: signatureWithModuleAddress,
    };
  }
}

export class HybridSKMSingleCallUtils extends HybridSKMUtils {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    entryPoint: EntryPoint,
    sessionKeyManager: SessionKeyManagerHybrid,
    ecdsaModule: EcdsaOwnershipRegistryModule
  ) {
    super(entryPoint, sessionKeyManager, ecdsaModule);
  }

  async makeEcdsaSessionKeySignedUserOpForEnableAndUseSession(
    userOpSender: string,
    executionCallParams: ExecutionCallParams,
    sessionKey: Signer,
    sessionData: ISessionKeyManagerModuleHybrid.SessionDataStruct,
    sessionEnableData: BytesLike,
    sessionEnableSignature: BytesLike,
    sessionIndex: number,
    options?: {
      preVerificationGas?: number;
    }
  ): Promise<UserOperation> {
    const callData = SmartAccount__factory.createInterface().encodeFunctionData(
      "execute",
      [
        executionCallParams.to,
        executionCallParams.value,
        executionCallParams.calldata,
      ]
    );

    const userOp = await fillAndSign(
      {
        sender: userOpSender,
        callData,
        ...options,
      },
      sessionKey,
      this.entryPoint,
      "nonce",
      true
    );

    const paddedSig = solidityPack(
      ["uint8", "uint8", "uint48", "uint48", "address", "bytes"],
      [
        TRANSACTION_MODE.ENABLE_AND_USE,
        sessionIndex,
        sessionData.validUntil,
        sessionData.validAfter,
        sessionData.sessionValidationModule,
        defaultAbiCoder.encode(
          ["bytes", "bytes", "bytes", "bytes"],
          [
            sessionData.sessionKeyData,
            sessionEnableData,
            sessionEnableSignature,
            userOp.signature,
          ]
        ),
      ]
    );

    const signatureWithModuleAddress = defaultAbiCoder.encode(
      ["bytes", "address"],
      [paddedSig, this.sessionKeyManager.address]
    );
    userOp.signature = signatureWithModuleAddress;

    return userOp;
  }

  async makeEcdsaSessionKeySignedUserOpForPreEnabledSession(
    userOpSender: string,
    executionCallParams: ExecutionCallParams,
    sessionKey: Signer,
    sessionData: ISessionKeyManagerModuleHybrid.SessionDataStruct,
    options?: {
      preVerificationGas?: number;
    }
  ): Promise<UserOperation> {
    const callData = SmartAccount__factory.createInterface().encodeFunctionData(
      "execute",
      [
        executionCallParams.to,
        executionCallParams.value,
        executionCallParams.calldata,
      ]
    );

    const userOp = await fillAndSign(
      {
        sender: userOpSender,
        callData,
        ...options,
      },
      sessionKey,
      this.entryPoint,
      "nonce",
      true
    );

    const paddedSig = solidityPack(
      ["uint8", "bytes"],
      [
        TRANSACTION_MODE.PRE_ENABLED,
        defaultAbiCoder.encode(
          ["bytes32", "bytes"],
          [await this.sessionDigest(sessionData), userOp.signature]
        ),
      ]
    );

    const signatureWithModuleAddress = defaultAbiCoder.encode(
      ["bytes", "address"],
      [paddedSig, this.sessionKeyManager.address]
    );
    userOp.signature = signatureWithModuleAddress;

    return userOp;
  }
}

export class HybridSKMBatchCallUtils extends HybridSKMUtils {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    entryPoint: EntryPoint,
    sessionKeyManager: SessionKeyManagerHybrid,
    ecdsaModule: EcdsaOwnershipRegistryModule
  ) {
    super(entryPoint, sessionKeyManager, ecdsaModule);
  }

  async makeEcdsaSessionKeySignedUserOp(
    userOpSender: string,
    executionCallParams: ExecutionCallParams[],
    sessionKey: Signer,
    sessionEnableDataList: BytesLike[],
    sessionEnableSignatureList: BytesLike[],
    sessionInfos: BytesLike[],
    options?: {
      preVerificationGas?: number;
    }
  ): Promise<UserOperation> {
    const callData = SmartAccount__factory.createInterface().encodeFunctionData(
      "executeBatch",
      [
        executionCallParams.map(({ to }) => to),
        executionCallParams.map(({ value }) => value),
        executionCallParams.map(({ calldata }) => calldata),
      ]
    );

    const userOp = await fillAndSign(
      {
        sender: userOpSender,
        callData,
        ...options,
      },
      sessionKey,
      this.entryPoint,
      "nonce",
      true
    );

    const paddedSig = defaultAbiCoder.encode(
      ["bytes[]", "bytes[]", "bytes[]", "bytes"],
      [
        sessionEnableDataList,
        sessionEnableSignatureList,
        sessionInfos,
        userOp.signature,
      ]
    );

    const signatureWithModuleAddress = defaultAbiCoder.encode(
      ["bytes", "address"],
      [paddedSig, this.sessionKeyManager.address]
    );
    userOp.signature = signatureWithModuleAddress;

    return userOp;
  }

  makeSessionEnableSessionInfo(
    sessionEnableDataIndex: number,
    sessionKeyIndex: number,
    sessionData: ISessionKeyManagerModuleHybrid.SessionDataStruct,
    callSpecificData: BytesLike
  ): BytesLike {
    return solidityPack(
      ["uint8", "uint8", "uint8", "uint48", "uint48", "address", "bytes"],
      [
        TRANSACTION_MODE.ENABLE_AND_USE,
        sessionEnableDataIndex,
        sessionKeyIndex,
        sessionData.validUntil,
        sessionData.validAfter,
        sessionData.sessionValidationModule,
        defaultAbiCoder.encode(
          ["bytes", "bytes"],
          [sessionData.sessionKeyData, callSpecificData]
        ),
      ]
    );
  }

  async makePreEnabledSessionInfo(
    sessionData: ISessionKeyManagerModuleHybrid.SessionDataStruct,
    callSpecificData: BytesLike
  ): Promise<BytesLike> {
    return solidityPack(
      ["uint8", "bytes32", "bytes"],
      [
        TRANSACTION_MODE.PRE_ENABLED,
        await this.sessionDigest(sessionData),
        defaultAbiCoder.encode(["bytes"], [callSpecificData]),
      ]
    );
  }
}
