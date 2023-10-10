import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { encodeTransfer } from "../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import {
  makeEcdsaModuleUserOp,
  makeUnsignedUserOp,
  getUserOpHash,
} from "../utils/userOp";
import {
  makeMultiSignedUserOpWithGuardiansList,
  makeMultisignedSubmitRecoveryRequestUserOp,
} from "../utils/accountRecovery";
import { defaultAbiCoder, keccak256 } from "ethers/lib/utils";

describe("Account Recovery Module: ", async () => {
  const [
    deployer,
    smartAccountOwner,
    alice,
    bob,
    charlie,
    verifiedSigner,
    eve,
    fox,
    newOwner,
    refundReceiver,
  ] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(
    async ({ deployments, getNamedAccounts }) => {
      const controlMessage = "ACCOUNT RECOVERY GUARDIAN SECURE MESSAGE";

      await deployments.fixture();

      const mockToken = await getMockToken();
      const entryPoint = await getEntryPoint();

      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);

      const ecdsaModule = await getEcdsaOwnershipRegistryModule();
      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [smartAccountOwner.address]
        );
      const smartAccountDeploymentIndex = 0;
      const userSA = await getSmartAccountWithModule(
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

      // top up acct balance
      await deployer.sendTransaction({
        to: userSA.address,
        value: ethers.utils.parseEther("10"),
      });
      await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

      // deploy Account Recovery Module
      const accountRecoveryModule = await (
        await ethers.getContractFactory("AccountRecoveryModule")
      ).deploy();

      const defaultSecurityDelay = 150;

      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash); // same should happen when signing with guardian private key

      const guardians = await Promise.all(
        [alice, bob, charlie].map(
          async (guardian): Promise<string> =>
            ethers.utils.keccak256(await guardian.signMessage(messageHashBytes))
        )
      );

      // enable and setup Social Recovery Module
      const socialRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [
            guardians,
            [
              [16741936496, 0],
              [16741936496, 0],
              [16741936496, 0],
            ],
            3,
            defaultSecurityDelay,
          ]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, socialRecoverySetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      await entryPoint.handleOps(
        [setupAndEnableUserOp],
        refundReceiver.address
      );

      // create a new account which is not yet initialized
      const ecdsaOwnershipSetupDataAlice =
        ecdsaModule.interface.encodeFunctionData("initForSmartAccount", [
          alice.address,
        ]);

      const aliceSA = await getSmartAccountWithModule(
        ecdsaModule.address,
        ecdsaOwnershipSetupDataAlice,
        smartAccountDeploymentIndex
      );

      // top up acct balance
      await deployer.sendTransaction({
        to: aliceSA.address,
        value: ethers.utils.parseEther("10"),
      });
      await mockToken.mint(aliceSA.address, ethers.utils.parseEther("1000000"));

      return {
        entryPoint: entryPoint,
        smartAccountImplementation: await getSmartAccountImplementation(),
        smartAccountFactory: await getSmartAccountFactory(),
        mockToken: mockToken,
        ecdsaModule: ecdsaModule,
        userSA: userSA,
        aliceSA: aliceSA,
        accountRecoveryModule: accountRecoveryModule,
        verifyingPaymaster: await getVerifyingPaymaster(
          deployer,
          verifiedSigner
        ),
        defaultSecurityDelay: defaultSecurityDelay,
        controlMessage: controlMessage,
        chainId: chainId,
      };
    }
  );

  /**
   * The delayed Social Recovery flow is the following:
   * 1. The recovery request with a proper number of signatures is submitted via
   * the userOp that calls the accountRecoveryModule.submitRecoveryRequest() function using the
   * execute() function of the userSA.
   * At this step social recovery module is used for both validation (check signatures) and
   * execution (SA.execute => AccountRecoveryModule.submitRecoveryRequest).
   * 2. After the delay has passed, the recovery request can be executed by anyone via the
   * userOp that calls the validationModule.chavalidationModul method.
   * At this step, Social Recovery Module is only used for validation: check if the request
   * with the appropriate calldata has been submitted and the delay has passed. Then the calldata
   * (that describes) the call to one of the validation modules, like ECDSA module, is executed.
   * This call will change the party that is authorized to sign userOp (signer key). This userOp
   * doesn't require any signature at all.
   */

  describe("initForSmartAccount", async () => {
    it("Successfully inits the Smart Account, by adding guardians and settings", async () => {
      const {
        entryPoint,
        aliceSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
      } = await setupTests();

      const userSASettingsBefore =
        await accountRecoveryModule.getSmartAccountSettings(aliceSA.address);
      const guardiansBefore = userSASettingsBefore.guardiansCount;
      const thresholdBefore = userSASettingsBefore.recoveryThreshold;
      const securityDelayBefore = userSASettingsBefore.securityDelay;

      const recoveryThreshold = 3;
      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash); // same should happen when signing with guardian private key

      const guardians = await Promise.all(
        [bob, eve, fox].map(
          async (guardian): Promise<string> =>
            ethers.utils.keccak256(await guardian.signMessage(messageHashBytes))
        )
      );

      const bobTimeFrame = [16741936493, 1];
      const eveTimeFrame = [16741936494, 2];
      const foxTimeFrame = [16741936495, 3];

      const timeFrames = [bobTimeFrame, eveTimeFrame, foxTimeFrame];

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [guardians, timeFrames, recoveryThreshold, defaultSecurityDelay]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        aliceSA.address,
        alice,
        entryPoint,
        ecdsaModule.address
      );

      const tx = await entryPoint.handleOps(
        [setupAndEnableUserOp],
        refundReceiver.address
      );

      // proper events are emitted
      for (let i = 0; i < guardians.length; i++) {
        await expect(tx)
          .to.emit(accountRecoveryModule, "GuardianAdded")
          .withArgs(aliceSA.address, guardians[i], timeFrames[i]);
      }

      const userSASettingsAfter =
        await accountRecoveryModule.getSmartAccountSettings(aliceSA.address);
      const guardiansAfter = userSASettingsAfter.guardiansCount;
      const thresholdAfter = userSASettingsAfter.recoveryThreshold;
      const securityDelayAfter = userSASettingsAfter.securityDelay;

      expect(guardiansBefore).to.equal(0);
      expect(guardiansAfter).to.equal(guardians.length);
      expect(thresholdBefore).to.equal(0);
      expect(thresholdAfter).to.equal(recoveryThreshold);
      expect(securityDelayBefore).to.equal(0);
      expect(securityDelayAfter).to.equal(defaultSecurityDelay);

      expect(
        await accountRecoveryModule.getGuardianParams(
          guardians[0],
          aliceSA.address
        )
      ).to.deep.equal(bobTimeFrame);
      expect(
        await accountRecoveryModule.getGuardianParams(
          guardians[1],
          aliceSA.address
        )
      ).to.deep.equal(eveTimeFrame);
      expect(
        await accountRecoveryModule.getGuardianParams(
          guardians[2],
          aliceSA.address
        )
      ).to.deep.equal(foxTimeFrame);
    });

    it("reverts if the SA has already been initialized", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
        chainId,
      } = await setupTests();

      const recoveryThreshold = 2;
      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash); // same should happen when signing with guardian private key

      const guardians = await Promise.all(
        [bob, eve, fox].map(
          async (guardian): Promise<string> =>
            ethers.utils.keccak256(await guardian.signMessage(messageHashBytes))
        )
      );

      const bobTimeFrame = [16741936493, 1];
      const eveTimeFrame = [16741936494, 2];
      const foxTimeFrame = [16741936495, 3];

      const timeFrames = [bobTimeFrame, eveTimeFrame, foxTimeFrame];

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [guardians, timeFrames, recoveryThreshold, defaultSecurityDelay]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx = await entryPoint.handleOps(
        [setupAndEnableUserOp],
        refundReceiver.address,
        {
          gasLimit: 10000000,
        }
      );

      const errorData = ethers.utils.hexConcat([
        ethers.utils.id("AlreadyInitedForSmartAccount(address)").slice(0, 10),
        ethers.utils.hexZeroPad(userSA.address, 32),
      ]);

      await expect(tx)
        .to.emit(entryPoint, "UserOperationRevertReason")
        .withArgs(
          getUserOpHash(setupAndEnableUserOp, entryPoint.address, chainId),
          setupAndEnableUserOp.sender,
          setupAndEnableUserOp.nonce,
          errorData
        );
    });

    it("reverts if the threshold provided is > then # of guardians", async () => {
      const {
        entryPoint,
        aliceSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
        chainId,
      } = await setupTests();

      const recoveryThreshold = 5;
      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash); // same should happen when signing with guardian private key

      const guardians = await Promise.all(
        [bob, eve, fox].map(
          async (guardian): Promise<string> =>
            ethers.utils.keccak256(await guardian.signMessage(messageHashBytes))
        )
      );

      const bobTimeFrame = [16741936493, 1];
      const eveTimeFrame = [16741936494, 2];
      const foxTimeFrame = [16741936495, 3];

      const timeFrames = [bobTimeFrame, eveTimeFrame, foxTimeFrame];

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [guardians, timeFrames, recoveryThreshold, defaultSecurityDelay]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        aliceSA.address,
        alice,
        entryPoint,
        ecdsaModule.address
      );
      const tx = await entryPoint.handleOps(
        [setupAndEnableUserOp],
        refundReceiver.address
      );

      const errorData = ethers.utils.hexConcat([
        ethers.utils.id("ThresholdTooHigh(uint8,uint256)").slice(0, 10),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(recoveryThreshold), 32),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(guardians.length), 32),
      ]);

      await expect(tx)
        .to.emit(entryPoint, "UserOperationRevertReason")
        .withArgs(
          getUserOpHash(setupAndEnableUserOp, entryPoint.address, chainId),
          setupAndEnableUserOp.sender,
          setupAndEnableUserOp.nonce,
          errorData
        );
    });

    it("reverts if the wrong amount of parameters provided", async () => {
      const {
        entryPoint,
        aliceSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
        chainId,
      } = await setupTests();

      const recoveryThreshold = 3;
      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash); // same should happen when signing with guardian private key

      const guardians = await Promise.all(
        [bob, eve, fox].map(
          async (guardian): Promise<string> =>
            ethers.utils.keccak256(await guardian.signMessage(messageHashBytes))
        )
      );

      const bobTimeFrame = [16741936493, 1];
      const eveTimeFrame = [16741936494, 2];

      const timeFrames = [bobTimeFrame, eveTimeFrame];

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [guardians, timeFrames, recoveryThreshold, defaultSecurityDelay]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        aliceSA.address,
        alice,
        entryPoint,
        ecdsaModule.address
      );
      const tx = await entryPoint.handleOps(
        [setupAndEnableUserOp],
        refundReceiver.address
      );

      await expect(tx)
        .to.emit(entryPoint, "UserOperationRevertReason")
        .withArgs(
          getUserOpHash(setupAndEnableUserOp, entryPoint.address, chainId),
          setupAndEnableUserOp.sender,
          setupAndEnableUserOp.nonce,
          ethers.utils.id("InvalidAmountOfGuardianParams()").slice(0, 10)
        );
    });

    it("reverts if 0 guardians and 0 threshold provided", async () => {
      const {
        entryPoint,
        aliceSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        chainId,
      } = await setupTests();

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [[], [], 0, defaultSecurityDelay]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        aliceSA.address,
        alice,
        entryPoint,
        ecdsaModule.address
      );
      const tx = await entryPoint.handleOps(
        [setupAndEnableUserOp],
        refundReceiver.address
      );

      await expect(tx)
        .to.emit(entryPoint, "UserOperationRevertReason")
        .withArgs(
          getUserOpHash(setupAndEnableUserOp, entryPoint.address, chainId),
          setupAndEnableUserOp.sender,
          setupAndEnableUserOp.nonce,
          ethers.utils.id("ZeroThreshold()").slice(0, 10)
        );
    });

    it("reverts if at least one guardian is a zero guardian", async () => {
      const {
        entryPoint,
        aliceSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
        chainId,
      } = await setupTests();

      const recoveryThreshold = 3;
      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash); // same should happen when signing with guardian private key

      const guardians = await Promise.all(
        [bob, eve].map(
          async (guardian): Promise<string> =>
            ethers.utils.keccak256(await guardian.signMessage(messageHashBytes))
        )
      );

      // emptyGuardian is bytes32 of zeros
      const emptyGuardian = ethers.utils.hexlify(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32)
      );
      guardians.push(emptyGuardian);

      const bobTimeFrame = [16741936493, 1];
      const eveTimeFrame = [16741936494, 2];
      const foxTimeFrame = [16741936495, 3];

      const timeFrames = [bobTimeFrame, eveTimeFrame, foxTimeFrame];

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [guardians, timeFrames, recoveryThreshold, defaultSecurityDelay]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        aliceSA.address,
        alice,
        entryPoint,
        ecdsaModule.address
      );
      const tx = await entryPoint.handleOps(
        [setupAndEnableUserOp],
        refundReceiver.address
      );

      await expect(tx)
        .to.emit(entryPoint, "UserOperationRevertReason")
        .withArgs(
          getUserOpHash(setupAndEnableUserOp, entryPoint.address, chainId),
          setupAndEnableUserOp.sender,
          setupAndEnableUserOp.nonce,
          ethers.utils.id("ZeroGuardian()").slice(0, 10)
        );
    });

    it("Should revert if validUntil < validAfter in any of the timeframes", async () => {
      const {
        entryPoint,
        aliceSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
        chainId,
      } = await setupTests();

      const recoveryThreshold = 3;
      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash); // same should happen when signing with guardian private key

      const guardians = await Promise.all(
        [bob, eve, fox].map(
          async (guardian): Promise<string> =>
            ethers.utils.keccak256(await guardian.signMessage(messageHashBytes))
        )
      );

      const bobTimeFrame = [16741936493, 1];
      const eveTimeFrame = [16741936494, 2];
      const foxTimeFrame = [16741936495, 16741936495 + 1];

      const timeFrames = [bobTimeFrame, eveTimeFrame, foxTimeFrame];

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [guardians, timeFrames, recoveryThreshold, defaultSecurityDelay]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        aliceSA.address,
        alice,
        entryPoint,
        ecdsaModule.address
      );
      const tx = await entryPoint.handleOps(
        [setupAndEnableUserOp],
        refundReceiver.address
      );

      const errorData = ethers.utils.hexConcat([
        ethers.utils.id("InvalidTimeFrame(uint48,uint48)").slice(0, 10),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(16741936495), 32),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(16741936495 + 1), 32),
      ]);

      await expect(tx)
        .to.emit(entryPoint, "UserOperationRevertReason")
        .withArgs(
          getUserOpHash(setupAndEnableUserOp, entryPoint.address, chainId),
          setupAndEnableUserOp.sender,
          setupAndEnableUserOp.nonce,
          errorData
        );
    });

    it("Should revert if validUntil is expired for any of the timeFrames", async () => {
      const {
        entryPoint,
        aliceSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
        chainId,
      } = await setupTests();

      const recoveryThreshold = 3;
      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash); // same should happen when signing with guardian private key

      const guardians = await Promise.all(
        [bob, eve, fox].map(
          async (guardian): Promise<string> =>
            ethers.utils.keccak256(await guardian.signMessage(messageHashBytes))
        )
      );

      const provider = entryPoint?.provider;
      const currentTimestamp = (await provider!.getBlock("latest")).timestamp;

      const bobTimeFrame = [16741936493, 1];
      const eveTimeFrame = [16741936494, 2];
      const foxTimeFrame = [currentTimestamp - 1, 3];

      const timeFrames = [bobTimeFrame, eveTimeFrame, foxTimeFrame];

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [guardians, timeFrames, recoveryThreshold, defaultSecurityDelay]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        aliceSA.address,
        alice,
        entryPoint,
        ecdsaModule.address
      );
      const tx = await entryPoint.handleOps(
        [setupAndEnableUserOp],
        refundReceiver.address
      );

      const errorData = ethers.utils.hexConcat([
        ethers.utils.id("ExpiredValidUntil(uint48)").slice(0, 10),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(foxTimeFrame[0]), 32),
      ]);

      await expect(tx)
        .to.emit(entryPoint, "UserOperationRevertReason")
        .withArgs(
          getUserOpHash(setupAndEnableUserOp, entryPoint.address, chainId),
          setupAndEnableUserOp.sender,
          setupAndEnableUserOp.nonce,
          errorData
        );
    });
  });

  describe("submitRecoveryRequest", async () => {
    it("Should be able to submit the recovery request validated via other modules", async () => {
      const {
        entryPoint,
        accountRecoveryModule,
        ecdsaModule,
        userSA,
        controlMessage,
      } = await setupTests();

      const recoveryRequestCallData = ecdsaModule.interface.encodeFunctionData(
        "transferOwnership",
        [newOwner.address]
      );

      const submitRequestCallData =
        accountRecoveryModule.interface.encodeFunctionData(
          "submitRecoveryRequest",
          [recoveryRequestCallData]
        );

      const submitRequestUserOp = await makeEcdsaModuleUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          submitRequestCallData,
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const handleOpsTxn = await entryPoint.handleOps(
        [submitRequestUserOp],
        alice.address,
        { gasLimit: 10000000 }
      );
      await handleOpsTxn.wait();

      const recoveryRequest = await accountRecoveryModule.getRecoveryRequest(
        userSA.address
      );
      expect(recoveryRequest.callDataHash).to.equal(
        ethers.utils.keccak256(recoveryRequestCallData)
      );
    });

    it("Should be able to submit recovery request directly and the request is recorded and event is emitted", async () => {
      const { accountRecoveryModule, ecdsaModule } = await setupTests();

      const recoveryRequestCallData = ecdsaModule.interface.encodeFunctionData(
        "transferOwnership",
        [newOwner.address]
      );

      const tx = await accountRecoveryModule.submitRecoveryRequest(
        recoveryRequestCallData
      );
      expect(tx)
        .to.emit(accountRecoveryModule, "RecoveryRequestSubmitted")
        .withArgs(
          deployer.address,
          ethers.utils.keccak256(recoveryRequestCallData)
        );

      const recoveryRequest = await accountRecoveryModule.getRecoveryRequest(
        deployer.address
      );

      expect(recoveryRequest.callDataHash).to.equal(
        ethers.utils.keccak256(recoveryRequestCallData)
      );
    });

    it("Should revert if such a request already exists", async () => {
      const { accountRecoveryModule, ecdsaModule } = await setupTests();

      const recoveryRequestCallData = ecdsaModule.interface.encodeFunctionData(
        "transferOwnership",
        [newOwner.address]
      );
      await accountRecoveryModule.submitRecoveryRequest(
        recoveryRequestCallData
      );

      await expect(
        accountRecoveryModule.submitRecoveryRequest(recoveryRequestCallData)
      )
        .to.be.revertedWith("RecoveryRequestAlreadyExists")
        .withArgs(
          deployer.address,
          ethers.utils.keccak256(recoveryRequestCallData)
        );
    });

    it("Should revert if empty calldata provided", async () => {
      const { accountRecoveryModule } = await setupTests();
      const recoveryRequestCallData = "0x";
      await expect(
        accountRecoveryModule.submitRecoveryRequest(recoveryRequestCallData)
      ).to.be.revertedWith("EmptyRecoveryCallData");
    });
  });

  describe("renounceRecoveryRequest", async () => {
    it("Should successfully remove the existing request", async () => {
      const { accountRecoveryModule, ecdsaModule } = await setupTests();

      const recoveryRequestCallData = ecdsaModule.interface.encodeFunctionData(
        "transferOwnership",
        [newOwner.address]
      );

      await accountRecoveryModule.submitRecoveryRequest(
        recoveryRequestCallData
      );
      const recoveryRequest = await accountRecoveryModule.getRecoveryRequest(
        deployer.address
      );
      expect(recoveryRequest.callDataHash).to.equal(
        ethers.utils.keccak256(recoveryRequestCallData)
      );

      await accountRecoveryModule.renounceRecoveryRequest();
      const recoveryRequestAfter =
        await accountRecoveryModule.getRecoveryRequest(deployer.address);
      const emptyGuardian = ethers.utils.hexlify(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32)
      );

      expect(recoveryRequestAfter.callDataHash).to.equal(
        ethers.utils.hexlify(
          ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32)
        )
      );
    });

    it("Does not revert even if the request for the caller is empty", async () => {
      const { accountRecoveryModule, ecdsaModule } = await setupTests();
      const txn = await accountRecoveryModule.renounceRecoveryRequest();
      await expect(txn).to.not.be.reverted;
    });
  });

  describe("Validation Flow", async () => {
    
    /*
    it("Should revert validating the execute-request userOp if the delay has not passed yet", async () => {

      // can not execute request before the delay passes
    await expect(
      entryPoint.handleOps([executeRecoveryRequestUserOp], alice.address, {
        gasLimit: 10000000,
      })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA22 expired or not due");

    });
    */

    it("Can submit a recovery request and execute it after a proper delay (no bundler)", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
      } = await setupTests();

      const arrayOfSigners = [alice, bob, charlie];
      arrayOfSigners.sort((a, b) => a.address.localeCompare(b.address));

      expect(
        await userSA.isModuleEnabled(accountRecoveryModule.address)
      ).to.equal(true);

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        [charlie, alice, bob],
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address, {
        gasLimit: 10000000,
      });
      await handleOpsTxn.wait();

      expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
        smartAccountOwner.address
      );

      // can be non signed at all, just needs to be executed after the delay
      const executeRecoveryRequestUserOp = await makeUnsignedUserOp(
        "execute",
        [
          ecdsaModule.address,
          ethers.utils.parseEther("0"),
          ecdsaModule.interface.encodeFunctionData("transferOwnership", [
            newOwner.address,
          ]),
        ],
        userSA.address,
        entryPoint,
        accountRecoveryModule.address
      );

      // fast forward
      await ethers.provider.send("evm_increaseTime", [
        defaultSecurityDelay + 12,
      ]);
      await ethers.provider.send("evm_mine", []);

      // now everything should work
      await entryPoint.handleOps(
        [executeRecoveryRequestUserOp],
        alice.address,
        {
          gasLimit: 10000000,
        }
      );
      expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
        newOwner.address
      );
      expect(await ecdsaModule.getOwner(userSA.address)).to.not.equal(
        smartAccountOwner.address
      );
    });

    it("Should be able to validate userOp and proceed to submitting the recovery request with the proper amount of guardians sigs", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
      } = await setupTests();

      const recoveryRequestCallData = userSA.interface.encodeFunctionData(
        "execute",
        [
          ecdsaModule.address,
          ethers.utils.parseEther("0"),
          ecdsaModule.interface.encodeFunctionData("transferOwnership", [
            newOwner.address,
          ]),
        ]
      );

      const userOp = await makeMultiSignedUserOpWithGuardiansList(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          accountRecoveryModule.interface.encodeFunctionData(
            "submitRecoveryRequest",
            [recoveryRequestCallData]
          ),
        ],
        userSA.address,
        [charlie, alice, bob], // order is important
        controlMessage,
        entryPoint,
        accountRecoveryModule.address
      );

      const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address, {
        gasLimit: 10000000,
      });
      await handleOpsTxn.wait();

      const recoveryRequest = await accountRecoveryModule.getRecoveryRequest(
        userSA.address
      );
      expect(recoveryRequest.callDataHash).to.equal(
        ethers.utils.keccak256(recoveryRequestCallData)
      );
    });

    it("Should immediately execute recovery request when delay is 0", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
      } = await setupTests();

      const changeSecurityDelayData =
        accountRecoveryModule.interface.encodeFunctionData("setSecurityDelay", [
          0,
        ]);

      const changeDelayUserOp = await makeEcdsaModuleUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          changeSecurityDelayData,
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const handleOpsTxn = await entryPoint.handleOps(
        [changeDelayUserOp],
        alice.address,
        {
          gasLimit: 10000000,
        }
      );
      await handleOpsTxn.wait();

      const userSASettings =
        await accountRecoveryModule.getSmartAccountSettings(userSA.address);
      expect(userSASettings.securityDelay).to.equal(0);

      // immediately execute the request, signed by the guardians
      const userOp = await makeMultiSignedUserOpWithGuardiansList(
        "execute",
        [
          ecdsaModule.address,
          ethers.utils.parseEther("0"),
          ecdsaModule.interface.encodeFunctionData("transferOwnership", [
            newOwner.address,
          ]),
        ],
        userSA.address,
        [charlie, alice, bob], // order is important
        controlMessage,
        entryPoint,
        accountRecoveryModule.address
      );

      const handleOpsTxn2 = await entryPoint.handleOps(
        [userOp],
        alice.address,
        {
          gasLimit: 10000000,
        }
      );
      await handleOpsTxn2.wait();

      expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
        newOwner.address
      );
      expect(await ecdsaModule.getOwner(userSA.address)).to.not.equal(
        smartAccountOwner.address
      );
    });

    it("Should not execute the same recovery request twice via unsigned userOp", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
      } = await setupTests();

      const arrayOfSigners = [alice, bob, charlie];
      arrayOfSigners.sort((a, b) => a.address.localeCompare(b.address));

      expect(
        await userSA.isModuleEnabled(accountRecoveryModule.address)
      ).to.equal(true);

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        [charlie, alice, bob],
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address, {
        gasLimit: 10000000,
      });
      await handleOpsTxn.wait();

      expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
        smartAccountOwner.address
      );

      // can be non signed at all, just needs to be executed after the delay
      const executeRecoveryRequestUserOp = await makeUnsignedUserOp(
        "execute",
        [
          ecdsaModule.address,
          ethers.utils.parseEther("0"),
          ecdsaModule.interface.encodeFunctionData("transferOwnership", [
            newOwner.address,
          ]),
        ],
        userSA.address,
        entryPoint,
        accountRecoveryModule.address
      );

      // fast forward
      await ethers.provider.send("evm_increaseTime", [
        defaultSecurityDelay + 12,
      ]);
      await ethers.provider.send("evm_mine", []);

      // now everything should work
      await entryPoint.handleOps(
        [executeRecoveryRequestUserOp],
        alice.address,
        {
          gasLimit: 10000000,
        }
      );

      const executeRecoveryRequestUserOp2 = await makeUnsignedUserOp(
        "execute",
        [
          ecdsaModule.address,
          ethers.utils.parseEther("0"),
          ecdsaModule.interface.encodeFunctionData("transferOwnership", [
            newOwner.address,
          ]),
        ],
        userSA.address,
        entryPoint,
        accountRecoveryModule.address
      );

      await expect(
        entryPoint.handleOps([executeRecoveryRequestUserOp2], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: AccRecovery: Invalid Sigs Length"); // fails as signatures.length is 0 and thus less than required
      // - even if the userOp would be properly signed, it would fail as security delay is > 0, and the userOp is not
      //   to submit a request. See the appropriate test case below in the 'ValidateUserOp' section
      // - if security delay is 0, see the next negative test.Aas it doesn't require submitting a request when security delay is 0
    });

    // when the delay is 0, the properly signed userOp to execute the request can not be validated twice (unless it was re-signed)
    it("Should not validate the recovery request to be executed twice when the delay is 0", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
      } = await setupTests();

      const changeSecurityDelayData =
        accountRecoveryModule.interface.encodeFunctionData("setSecurityDelay", [
          0,
        ]);

      const changeDelayUserOp = await makeEcdsaModuleUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          changeSecurityDelayData,
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const handleOpsTxn = await entryPoint.handleOps(
        [changeDelayUserOp],
        alice.address,
        {
          gasLimit: 10000000,
        }
      );
      await handleOpsTxn.wait();

      const userSASettings =
        await accountRecoveryModule.getSmartAccountSettings(userSA.address);
      expect(userSASettings.securityDelay).to.equal(0);

      // immediately execute the request, signed by the guardians
      const userOp = await makeMultiSignedUserOpWithGuardiansList(
        "execute",
        [
          ecdsaModule.address,
          ethers.utils.parseEther("0"),
          ecdsaModule.interface.encodeFunctionData("transferOwnership", [
            newOwner.address,
          ]),
        ],
        userSA.address,
        [charlie, alice, bob], // order is important
        controlMessage,
        entryPoint,
        accountRecoveryModule.address
      );

      const handleOpsTxn2 = await entryPoint.handleOps(
        [userOp],
        alice.address,
        {
          gasLimit: 10000000,
        }
      );
      await handleOpsTxn2.wait();

      await expect(
        entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA25 invalid account nonce");
    });
  });

  describe("validateUserOp", async () => {
    it("Should revert if the delay is >0 and the calldata is NOT for submitting request", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
      } = await setupTests();

      // the userOp.callData is not the submitRequest one
      const userOp = await makeMultiSignedUserOpWithGuardiansList(
        "execute",
        [
          ecdsaModule.address,
          ethers.utils.parseEther("0"),
          ecdsaModule.interface.encodeFunctionData("transferOwnership", [
            newOwner.address,
          ]),
        ],
        userSA.address,
        [charlie, alice, bob], // order is important
        controlMessage,
        entryPoint,
        accountRecoveryModule.address
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: AccRecovery: Wrong userOp");
    });

    it("Should revert if the delay is 0 and the calldata IS for submitting request", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
      } = await setupTests();

      const changeSecurityDelayData =
        accountRecoveryModule.interface.encodeFunctionData("setSecurityDelay", [
          0,
        ]);

      const changeDelayUserOp = await makeEcdsaModuleUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          changeSecurityDelayData,
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const handleOpsTxn = await entryPoint.handleOps(
        [changeDelayUserOp],
        alice.address,
        {
          gasLimit: 10000000,
        }
      );
      await handleOpsTxn.wait();

      const userSASettings =
        await accountRecoveryModule.getSmartAccountSettings(userSA.address);
      expect(userSASettings.securityDelay).to.equal(0);

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        [charlie, alice, bob],
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: AccRecovery: Wrong userOp");
    });

    it("Should revert if userOp.callData of the request doesn't match the submitted request", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
      } = await setupTests();

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        [charlie, alice, bob],
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      entryPoint.handleOps([userOp], alice.address);

      const executeRecoveryRequestUserOp = await makeUnsignedUserOp(
        "execute",
        [
          ecdsaModule.address,
          ethers.utils.parseEther("0"),
          ecdsaModule.interface.encodeFunctionData("transferOwnership", [
            charlie.address, // not the one we set in the recovery request
          ]),
        ],
        userSA.address,
        entryPoint,
        accountRecoveryModule.address
      );

      await expect(
        entryPoint.handleOps([executeRecoveryRequestUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: AccRecovery: Invalid Sigs Length");
    });

    // reverts if threshold has been somehow set to 0 or not set at all

    // revert if trying to submit the unsigned request ('signature' is empty)

    it("Should revert if there's not enough signatures", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
      } = await setupTests();

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        [charlie, alice],
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: AccRecovery: Invalid Sigs Length");
    });
/*

    it("Should revert if at least one guardian is expired", async () => {});

    it("Should revert if at least one guardian is not yet active", async () => {});

    it("Should revert if expired and not yet active cases  intersect", async () => {});

    it("Should revert if at least one signature is invalid", async () => {});

    it("Should revert if the signature is for other module", async () => {});

    it("Should revert if guardians are not unique", async () => {});

    it("Events are emitted properly", async () => {});
    */
  });

  // Execution stage
  // it("Should revert if trying to execute the request with invalid calldata", async () => {});
  
  // it("can change from one validation module to another (by enabling and setting it up) when making recovery", async () => {});

  describe("addGuardian", async () => {
    it("Can add a guardian", async () => {
      const { entryPoint, userSA, accountRecoveryModule, ecdsaModule } =
        await setupTests();

      const newGuardian = ethers.utils.keccak256(eve.address);

      const guardiansBefore = (
        await accountRecoveryModule.getSmartAccountSettings(userSA.address)
      ).guardiansCount;

      const addGuardianData =
        accountRecoveryModule.interface.encodeFunctionData("addGuardian", [
          newGuardian,
          16741936496,
          0,
        ]);

      const addGuardianUserOp = await makeEcdsaModuleUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          addGuardianData,
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      const handleOpsTxn = await entryPoint.handleOps(
        [addGuardianUserOp],
        alice.address,
        { gasLimit: 10000000 }
      );
      const receipt = await handleOpsTxn.wait();
      const receiptTimestamp = (
        await ethers.provider.getBlock(receipt.blockNumber)
      ).timestamp;

      const userSASettings =
        await accountRecoveryModule.getSmartAccountSettings(userSA.address);
      const guardiansAfter = userSASettings.guardiansCount;

      const eveTimeFrame = await accountRecoveryModule.getGuardianParams(
        newGuardian,
        userSA.address
      );
      expect(eveTimeFrame.validUntil).to.equal(16741936496);
      expect(eveTimeFrame.validAfter).to.equal(
        receiptTimestamp + userSASettings.securityDelay
      );
      expect(guardiansAfter).to.equal(guardiansBefore + 1);
    });

    // it("_________", async () => {});
  });

  /*
  describe("changeGuardian", async () => {
    it("_________", async () => {});
  });

  describe("removeGuardian", async () => {
    it("_________", async () => {});
  });


  // DISABLE ACC RECOVERY


  // Check all the errors declarations to be actually used in the contract code
  // as 'requires' should be used during the validation

  // for the execution stage (all methods not related to validateUserOp) custom errors can be used
  // make the according explanation in the smart contract header

  */
});
