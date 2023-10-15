import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
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
  fillUserOp,
} from "../utils/userOp";
import {
  makeMultiSignedUserOpWithGuardiansList,
  makeMultisignedSubmitRecoveryRequestUserOp,
} from "../utils/accountRecovery";
import { arrayify } from "ethers/lib/utils";
import {Contract} from "ethers";

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

      const { chainId } = await entryPoint.provider.getNetwork();

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

      const closestValidUntil = 1760095431;

      // enable and setup Social Recovery Module
      const socialRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [
            guardians,
            [
              [closestValidUntil, 0], // 2025
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

      const arrayOfSigners = [alice, bob, charlie];
      arrayOfSigners.sort((a, b) => a.address.localeCompare(b.address));

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
        closestValidUntil: closestValidUntil,
        guardians: guardians,
        arrayOfSigners: arrayOfSigners,
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
      const { entryPoint, accountRecoveryModule, ecdsaModule, userSA } =
        await setupTests();

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

      const renounceTxn = await accountRecoveryModule.renounceRecoveryRequest();
      expect(renounceTxn)
        .to.emit(accountRecoveryModule, "RecoveryRequestRenounced")
        .withArgs(deployer.address);

      const recoveryRequestAfter =
        await accountRecoveryModule.getRecoveryRequest(deployer.address);
      const emptyGuardian = ethers.utils.hexlify(
        ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 32)
      );

      expect(recoveryRequestAfter.callDataHash).to.equal(emptyGuardian);
    });

    it("Does not revert even if the request for the caller is empty", async () => {
      const { accountRecoveryModule, ecdsaModule } = await setupTests();
      const txn = await accountRecoveryModule.renounceRecoveryRequest();
      await expect(txn).to.not.be.reverted;
    });
  });

  describe("Validation Flow", async () => {
    it("Should revert validating the execute-request userOp if the delay has not passed yet", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
        arrayOfSigners,
      } = await setupTests();

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        arrayOfSigners,
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

      // can not execute request before the delay passes
      await expect(
        entryPoint.handleOps([executeRecoveryRequestUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA22 expired or not due");
    });

    it("Can submit a recovery request and execute it after a proper delay (no bundler)", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
        arrayOfSigners,
      } = await setupTests();

      expect(
        await userSA.isModuleEnabled(accountRecoveryModule.address)
      ).to.equal(true);

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        arrayOfSigners,
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
        arrayOfSigners,
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
        arrayOfSigners, // order is important
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
        arrayOfSigners,
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
        arrayOfSigners, // order is important
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
        arrayOfSigners,
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
        arrayOfSigners,
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
        arrayOfSigners, // order is important
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
        arrayOfSigners,
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
        arrayOfSigners, // order is important
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
        arrayOfSigners,
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
        arrayOfSigners,
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
        arrayOfSigners,
      } = await setupTests();

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        arrayOfSigners,
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

    it("Should revert if the recovery threshold is 0", async () => {
      const {
        entryPoint,
        accountRecoveryModule,
        ecdsaModule,
        aliceSA,
        controlMessage,
        arrayOfSigners,
      } = await setupTests();

      const enableUserOp = await makeEcdsaModuleUserOp(
        "enableModule",
        [accountRecoveryModule.address],
        aliceSA.address,
        alice,
        entryPoint,
        ecdsaModule.address
      );
      await entryPoint.handleOps([enableUserOp], refundReceiver.address);

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        aliceSA.address,
        arrayOfSigners,
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      await expect(
        entryPoint.handleOps([userOp], refundReceiver.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: AccRecovery: Threshold not set");
    });

    it("Should revert if trying to submit the unsigned request ('signature' is empty)", async () => {
      const { entryPoint, userSA, accountRecoveryModule, ecdsaModule } =
        await setupTests();

      const userOp = await makeUnsignedUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          accountRecoveryModule.interface.encodeFunctionData(
            "submitRecoveryRequest",
            [
              ecdsaModule.interface.encodeFunctionData("transferOwnership", [
                newOwner.address,
              ]),
            ]
          ),
        ],
        userSA.address,
        entryPoint,
        accountRecoveryModule.address
      );

      await expect(
        entryPoint.handleOps([userOp], refundReceiver.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: AccRecovery: Invalid Sigs Length");
    });

    it("Should revert if there's not enough signatures", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
        arrayOfSigners,
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

    it("Should revert if at least one guardian is expired", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
        closestValidUntil,
        arrayOfSigners,
      } = await setupTests();

      // warp to the closest validUntil + some time
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        closestValidUntil + 12,
      ]);

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        arrayOfSigners,
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA22 expired or not due");
    });

    it("Should revert if at least one guardian is not yet active", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
        guardians,
        arrayOfSigners,
      } = await setupTests();

      // current timestamp
      const currentTimestamp = (await ethers.provider.getBlock("latest"))
        .timestamp;

      const changeGuardianUserOp = await makeEcdsaModuleUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          accountRecoveryModule.interface.encodeFunctionData(
            "changeGuardianParams",
            [guardians[0], 17641936496, currentTimestamp + 1000]
          ),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      await entryPoint.handleOps([changeGuardianUserOp], alice.address);

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        arrayOfSigners,
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA22 expired or not due");
    });

    it("Should revert if expired and not yet active cases intersect", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
        guardians,
        closestValidUntil,
        arrayOfSigners,
      } = await setupTests();

      // current timestamp
      const currentTimestamp = (await ethers.provider.getBlock("latest"))
        .timestamp;

      const changeGuardianUserOp = await makeEcdsaModuleUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          accountRecoveryModule.interface.encodeFunctionData(
            "changeGuardianParams",
            [
              guardians[1],
              17641936496, 
              closestValidUntil + 1000, // validAfter for this guardian is after previous one expires
            ]
          ),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      await entryPoint.handleOps([changeGuardianUserOp], alice.address);

      await ethers.provider.send("evm_setNextBlockTimestamp", [
        closestValidUntil + 500,
      ]);

      const userOp = await makeMultisignedSubmitRecoveryRequestUserOp(
        "transferOwnership",
        [newOwner.address],
        ecdsaModule,
        userSA.address,
        arrayOfSigners,
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA22 expired or not due");
    });

    it("Should return SIG_VALIDATION_FAILED if at least one signature is invalid", async () => {
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
        [charlie, alice, eve], // eve is not a guardian
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA24 signature error");
    });

    it("Should return SIG_VALIDATION_FAILED if userOp signer does not match guardian provided with the userOp", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
        arrayOfSigners,
      } = await setupTests();

      const userOp = await makeUnsignedUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          accountRecoveryModule.interface.encodeFunctionData(
            "submitRecoveryRequest",
            [
              ecdsaModule.interface.encodeFunctionData("transferOwnership", [
                newOwner.address,
              ]),
            ]
          ),
        ],
        userSA.address,
        entryPoint,
        accountRecoveryModule.address
      );

      const { chainId } = await entryPoint.provider.getNetwork();
      const messageUserOp = arrayify(
        getUserOpHash(userOp, entryPoint!.address, chainId)
      );
      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash);

      let signatures = "0x";

      const wrongArrayOfSigners = [charlie, eve, bob]; // eve != alice

      for (let i = 0; i < arrayOfSigners.length; i++) {
        const sig = await arrayOfSigners[i].signMessage(messageUserOp);
        const guardian = await wrongArrayOfSigners[i].signMessage(
          messageHashBytes
        ); // so the signers for the userOpHash and controlMessage do not match
        signatures = signatures + sig.slice(2) + guardian.slice(2);
      }

      // add validator module address to the signature
      const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"],
        [signatures, accountRecoveryModule.address]
      );

      userOp.signature = signatureWithModuleAddress;

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA24 signature error");
    });

    it("Should revert if the signature is for other module", async () => {
      const { entryPoint, userSA, accountRecoveryModule, ecdsaModule } =
        await setupTests();

      const userOp = await makeEcdsaModuleUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          accountRecoveryModule.interface.encodeFunctionData(
            "submitRecoveryRequest",
            [
              ecdsaModule.interface.encodeFunctionData("transferOwnership", [
                newOwner.address,
              ]),
            ]
          ),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        accountRecoveryModule.address // use account recovery module as validator
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: AccRecovery: Invalid Sigs Length");
    });

    it("Should revert if guardians are not unique", async () => {
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
        [charlie, alice, alice],
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: AccRecovery: NotUnique/BadOrder");
    });

    it("Reverts if signatures are not sorted by the ascending signer's address", async () => {
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
        [alice, bob, charlie], // they are not sorted by ascendance of eth addresses
        controlMessage,
        entryPoint,
        accountRecoveryModule
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: AccRecovery: NotUnique/BadOrder");
    });
  });

  describe("Execution stage", async () => {
    it("Can change from one validation module to another (by enabling and setting it up) when making recovery", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
        arrayOfSigners,
        defaultSecurityDelay,
      } = await setupTests();

      const mockValidationModule = await (
        await ethers.getContractFactory("MockAuthModule")
      ).deploy();

      const executeBatchParams = [
        [ecdsaModule.address, userSA.address],
        [ethers.utils.parseEther("0"), ethers.utils.parseEther("0")],
        [
          ecdsaModule.interface.encodeFunctionData("renounceOwnership", []),
          userSA.interface.encodeFunctionData("setupAndEnableModule", [
            mockValidationModule.address,
            mockValidationModule.interface.encodeFunctionData("init", [
              0xdecaf,
            ]),
          ]),
        ],
      ];

      const recoveryRequestCallData = userSA.interface.encodeFunctionData(
        "executeBatch",
        executeBatchParams
      );

      const addRequestUserOp = await makeMultiSignedUserOpWithGuardiansList(
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
        arrayOfSigners,
        controlMessage,
        entryPoint,
        accountRecoveryModule.address
      );

      await entryPoint.handleOps([addRequestUserOp], alice.address, {
        gasLimit: 10000000,
      });

      const executeRecoveryRequestUserOp = await makeUnsignedUserOp(
        "executeBatch",
        executeBatchParams,
        userSA.address,
        entryPoint,
        accountRecoveryModule.address
      );

      await ethers.provider.send("evm_increaseTime", [
        defaultSecurityDelay + 12,
      ]);
      await ethers.provider.send("evm_mine", []);

      const executeRequestTxn = await entryPoint.handleOps(
        [executeRecoveryRequestUserOp],
        alice.address,
        { gasLimit: 10000000 }
      );
      expect(executeRequestTxn).to.emit(ecdsaModule, "OwnershipTransferred");
      expect(
        await userSA.isModuleEnabled(mockValidationModule.address)
      ).to.equal(true);
    });

    it("The request with invalid calldata for the module executes but does nothing", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
        arrayOfSigners,
        defaultSecurityDelay,
      } = await setupTests();

      const invalidCallData = "0xdecafdecaf";

      const invalidArgs = [
        ecdsaModule.address,
        ethers.utils.parseEther("0"),
        invalidCallData,
      ];

      const recoveryRequestCallData = userSA.interface.encodeFunctionData(
        "execute",
        invalidArgs
      );

      const addRequestUserOp = await makeMultiSignedUserOpWithGuardiansList(
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
        arrayOfSigners,
        controlMessage,
        entryPoint,
        accountRecoveryModule.address
      );

      await entryPoint.handleOps([addRequestUserOp], alice.address, {
        gasLimit: 10000000,
      });

      const executeRecoveryRequestUserOp = await makeUnsignedUserOp(
        "execute",
        invalidArgs,
        userSA.address,
        entryPoint,
        accountRecoveryModule.address
      );

      await ethers.provider.send("evm_increaseTime", [
        defaultSecurityDelay + 12,
      ]);
      await ethers.provider.send("evm_mine", []);

      await entryPoint.handleOps(
        [executeRecoveryRequestUserOp],
        alice.address,
        { gasLimit: 10000000 }
      );
      expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
        smartAccountOwner.address
      );
    });

    it("Executing request with completely invalid calldata reverts", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        controlMessage,
        arrayOfSigners,
        defaultSecurityDelay,
        chainId,
      } = await setupTests();

      const recoveryRequestCallData = "0xdecafdecaf";

      const addRequestUserOp = await makeMultiSignedUserOpWithGuardiansList(
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
        arrayOfSigners,
        controlMessage,
        entryPoint,
        accountRecoveryModule.address
      );

      await entryPoint.handleOps([addRequestUserOp], alice.address, {
        gasLimit: 10000000,
      });

      const executeRecoveryRequestUserOp = await fillUserOp(
        {
          sender: userSA.address,
          callData: recoveryRequestCallData,
        },
        entryPoint,
        "nonce"
      );

      const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"],
        [0x0, accountRecoveryModule.address]
      );

      executeRecoveryRequestUserOp.signature = signatureWithModuleAddress;

      await ethers.provider.send("evm_increaseTime", [
        defaultSecurityDelay + 12,
      ]);
      await ethers.provider.send("evm_mine", []);

      const errorData = ethers.utils.hexConcat([
        ethers.utils.id("NonExistingMethodCalled(bytes4)").slice(0, 10),
        recoveryRequestCallData.slice(0, 10),
        ethers.utils.hexZeroPad("0x", 28), // add zeros
      ]);

      const txn = await entryPoint.handleOps(
        [executeRecoveryRequestUserOp],
        alice.address,
        { gasLimit: 10000000 }
      );
      expect(await txn)
        .to.emit(entryPoint, "UserOperationRevertReason")
        .withArgs(
          getUserOpHash(
            executeRecoveryRequestUserOp,
            entryPoint.address,
            chainId
          ),
          executeRecoveryRequestUserOp.sender,
          executeRecoveryRequestUserOp.nonce,
          errorData
        );
      expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
        smartAccountOwner.address
      );
    });
  });

  describe("addGuardian", async () => {
    let newGuardian: string;

    before(async () => {
      const { controlMessage } = await setupTests();

      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash);

      newGuardian = ethers.utils.keccak256(
        await eve.signMessage(messageHashBytes)
      );
    });

    it("Can add a guardian and proper event is emitted", async () => {
      const { entryPoint, userSA, accountRecoveryModule, ecdsaModule } =
        await setupTests();

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

      const expectedTimeFrame = {
        validUntil: 16741936496,
        validAfter: receiptTimestamp + userSASettings.securityDelay,
      };

      expect(handleOpsTxn)
        .to.emit(accountRecoveryModule, "GuardianAdded")
        .withArgs(userSA.address, newGuardian, expectedTimeFrame);

      const eveTimeFrame = await accountRecoveryModule.getGuardianParams(
        newGuardian,
        userSA.address
      );
      expect(eveTimeFrame.validUntil).to.equal(expectedTimeFrame.validUntil);
      expect(eveTimeFrame.validAfter).to.equal(expectedTimeFrame.validAfter);
      expect(guardiansAfter).to.equal(guardiansBefore + 1);
    });

    it("Should revert if zero guardian is provided", async () => {
      const { accountRecoveryModule } = await setupTests();

      // assign empty bytes32
      const zeroGuardian = ethers.utils.hexZeroPad("0x", 32);
      const guardiansCountBefore = (
        await accountRecoveryModule.getSmartAccountSettings(deployer.address)
      ).guardiansCount;

      await expect(
        accountRecoveryModule.addGuardian(zeroGuardian, 16741936496, 0)
      ).to.be.revertedWith("ZeroGuardian");

      const guardiansCountAfter = (
        await accountRecoveryModule.getSmartAccountSettings(deployer.address)
      ).guardiansCount;
      expect(guardiansCountAfter).to.equal(guardiansCountBefore);
    });

    it("Should revert if such a guardian has already been set", async () => {
      const { accountRecoveryModule, guardians } = await setupTests();

      const guardian = guardians[1];

      // add guardian first
      await accountRecoveryModule.addGuardian(guardian, 15555934444, 0);

      const guardiansCountBefore = (
        await accountRecoveryModule.getSmartAccountSettings(deployer.address)
      ).guardiansCount;

      await expect(accountRecoveryModule.addGuardian(guardian, 15555934444, 0))
        .to.be.revertedWith("GuardianAlreadySet")
        .withArgs(guardian, deployer.address);

      const guardiansCountAfter = (
        await accountRecoveryModule.getSmartAccountSettings(deployer.address)
      ).guardiansCount;
      expect(guardiansCountAfter).to.equal(guardiansCountBefore);
    });

    it("Should set validUntil to uint48.max if validUntil = 0 is provided", async () => {
      const { accountRecoveryModule } = await setupTests();

      const validUntil = 0;
      const validAfter = 0;

      // add guardian first
      await accountRecoveryModule.addGuardian(
        newGuardian,
        validUntil,
        validAfter
      );

      const newGuardianTimeFrame =
        await accountRecoveryModule.getGuardianParams(
          newGuardian,
          deployer.address
        );

      expect(newGuardianTimeFrame.validUntil).to.equal(2 ** 48 - 1);
    });

    it("Should set validAfter as guardian.timeframe.validAfter if it is bigger than now+securityDelay", async () => {
      const { accountRecoveryModule, defaultSecurityDelay } =
        await setupTests();
      await accountRecoveryModule.setSecurityDelay(defaultSecurityDelay);

      const nowPlusSecurityDelay =
        (await ethers.provider.getBlock("latest")).timestamp +
        defaultSecurityDelay;

      const validAfter = nowPlusSecurityDelay + 1000;

      await accountRecoveryModule.addGuardian(
        newGuardian,
        15555934444,
        validAfter
      );

      const guardianDetails = await accountRecoveryModule.getGuardianParams(
        newGuardian,
        deployer.address
      );

      expect(guardianDetails.validAfter).to.equal(validAfter);
    });

    it("Should set now+securityDelay if validAfter is less than it", async () => {
      const { accountRecoveryModule, defaultSecurityDelay } =
        await setupTests();
      await accountRecoveryModule.setSecurityDelay(defaultSecurityDelay);

      const nowPlusSecurityDelay =
        (await ethers.provider.getBlock("latest")).timestamp +
        defaultSecurityDelay;

      const validAfter = nowPlusSecurityDelay - 1000;

      await accountRecoveryModule.addGuardian(
        newGuardian,
        15555934444,
        validAfter
      );

      const guardianDetails = await accountRecoveryModule.getGuardianParams(
        newGuardian,
        deployer.address
      );

      expect(guardianDetails.validAfter).to.be.gte(nowPlusSecurityDelay);
    });

    it("Should revert if validUntil is less than resulting validAfter", async () => {
      const { accountRecoveryModule, defaultSecurityDelay } =
        await setupTests();

      const nowPlusSecurityDelay =
        (await ethers.provider.getBlock("latest")).timestamp +
        defaultSecurityDelay;

      const validAfter = nowPlusSecurityDelay + 1000;
      const validUntil = nowPlusSecurityDelay - 1000;

      await expect(
        accountRecoveryModule.addGuardian(newGuardian, validUntil, validAfter)
      )
        .to.be.revertedWith("InvalidTimeFrame")
        .withArgs(validUntil, validAfter);
    });
  });

  describe("replaceGuardian", async () => {
    let newGuardian: string;

    before(async () => {
      const { controlMessage } = await setupTests();

      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash);

      newGuardian = ethers.utils.keccak256(
        await eve.signMessage(messageHashBytes)
      );
    });

    it("Can replace guardian, old is deleted, new is active, guardians count has not changed and events are emitted", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        guardians,
      } = await setupTests();

      const guardianToRemove = guardians[1];
      const guardiansBefore = (
        await accountRecoveryModule.getSmartAccountSettings(userSA.address)
      ).guardiansCount;

      const addGuardianData =
        accountRecoveryModule.interface.encodeFunctionData("replaceGuardian", [
          guardianToRemove,
          newGuardian,
          16741936496,
          0,
        ]);

      const replaceGuardianUserOp = await makeEcdsaModuleUserOp(
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
        [replaceGuardianUserOp],
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

      const expectedTimeFrame = {
        validUntil: 16741936496,
        validAfter: receiptTimestamp + userSASettings.securityDelay,
      };

      expect(handleOpsTxn)
        .to.emit(accountRecoveryModule, "GuardianAdded")
        .withArgs(userSA.address, newGuardian, expectedTimeFrame);

      expect(handleOpsTxn)
        .to.emit(accountRecoveryModule, "GuardianRemoved")
        .withArgs(userSA.address, guardianToRemove);

      const newGuardianTimeFrame =
        await accountRecoveryModule.getGuardianParams(
          newGuardian,
          userSA.address
        );
      const removedGuardianTimeFrame =
        await accountRecoveryModule.getGuardianParams(
          guardianToRemove,
          userSA.address
        );
      expect(newGuardianTimeFrame.validUntil).to.equal(
        expectedTimeFrame.validUntil
      );
      expect(newGuardianTimeFrame.validAfter).to.equal(
        expectedTimeFrame.validAfter
      );
      expect(removedGuardianTimeFrame.validUntil).to.equal(0);
      expect(removedGuardianTimeFrame.validAfter).to.equal(0);
      expect(guardiansAfter).to.equal(guardiansBefore);
    });

    it("reverts if guardian has not been set", async () => {
      const { accountRecoveryModule, guardians } = await setupTests();

      // no guardians are set for deployer
      const guardianToReplace = guardians[1];

      await expect(
        accountRecoveryModule.replaceGuardian(
          guardianToReplace,
          newGuardian,
          16741936496,
          0
        )
      )
        .to.be.revertedWith("GuardianNotSet")
        .withArgs(guardianToReplace, deployer.address);
    });

    it("reverts if guardian to replace and new guardian are identical", async () => {
      const { accountRecoveryModule, guardians } = await setupTests();
      await accountRecoveryModule.addGuardian(newGuardian, 16741936496, 0);

      await expect(
        accountRecoveryModule.replaceGuardian(
          newGuardian,
          newGuardian,
          16741936496,
          0
        )
      ).to.be.revertedWith("GuardiansAreIdentical");
    });

    it("reverts if new guardian is zero", async () => {
      const { accountRecoveryModule, guardians } = await setupTests();

      await accountRecoveryModule.addGuardian(guardians[1], 16741936496, 0);

      const zeroGuardian = ethers.utils.hexZeroPad("0x", 32);

      await expect(
        accountRecoveryModule.replaceGuardian(
          guardians[1],
          zeroGuardian,
          16741936496,
          0
        )
      ).to.be.revertedWith("ZeroGuardian");
    });
  });

  describe("removeGuardian", async () => {
    it("Can remove guardian and it is removed and the event is emitted", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        guardians,
      } = await setupTests();

      const guardianToRemove = guardians[1];
      const guardiansBefore = (
        await accountRecoveryModule.getSmartAccountSettings(userSA.address)
      ).guardiansCount;

      const removeGuardianData =
        accountRecoveryModule.interface.encodeFunctionData("removeGuardian", [
          guardianToRemove,
        ]);

      const replaceGuardianUserOp = await makeEcdsaModuleUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          removeGuardianData,
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      const handleOpsTxn = await entryPoint.handleOps(
        [replaceGuardianUserOp],
        alice.address,
        { gasLimit: 10000000 }
      );
      expect(handleOpsTxn)
        .to.emit(accountRecoveryModule, "GuardianRemoved")
        .withArgs(userSA.address, guardianToRemove);

      const userSASettings =
        await accountRecoveryModule.getSmartAccountSettings(userSA.address);
      const guardianTimeFrame = await accountRecoveryModule.getGuardianParams(
        guardianToRemove,
        userSA.address
      );
      const guardiansAfter = userSASettings.guardiansCount;
      expect(guardianTimeFrame.validUntil).to.equal(0);
      expect(guardianTimeFrame.validAfter).to.equal(0);
      expect(guardiansAfter).to.equal(guardiansBefore - 1);
    });

    it("The threshold is adjusted if needed and event is emitted", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        guardians,
      } = await setupTests();

      const guardianToRemove = guardians[1];
      const guardiansBefore = (
        await accountRecoveryModule.getSmartAccountSettings(userSA.address)
      ).guardiansCount;
      const thresholdBefore = (
        await accountRecoveryModule.getSmartAccountSettings(userSA.address)
      ).recoveryThreshold;
      expect(thresholdBefore).to.equal(guardiansBefore);

      const removeGuardianData =
        accountRecoveryModule.interface.encodeFunctionData("removeGuardian", [
          guardianToRemove,
        ]);

      const replaceGuardianUserOp = await makeEcdsaModuleUserOp(
        "execute",
        [
          accountRecoveryModule.address,
          ethers.utils.parseEther("0"),
          removeGuardianData,
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      const handleOpsTxn = await entryPoint.handleOps(
        [replaceGuardianUserOp],
        alice.address,
        { gasLimit: 10000000 }
      );
      expect(handleOpsTxn)
        .to.emit(accountRecoveryModule, "ThresholdChanged")
        .withArgs(userSA.address, thresholdBefore - 1);

      const userSASettings =
        await accountRecoveryModule.getSmartAccountSettings(userSA.address);

      expect(userSASettings.recoveryThreshold).to.equal(thresholdBefore - 1);
    });

    it("Reverts if the guardian has not been set", async () => {
      const { accountRecoveryModule, guardians } = await setupTests();

      // no guardians are set for deployer
      const guardianToRemove = guardians[1];

      await expect(accountRecoveryModule.removeGuardian(guardianToRemove))
        .to.be.revertedWith("GuardianNotSet")
        .withArgs(guardianToRemove, deployer.address);
    });
  });

  describe("removeExpiredGuardian", async () => {
    it("Anyone can remove the expired guardian", async () => {
      const { accountRecoveryModule, guardians } = await setupTests();

      await accountRecoveryModule.addGuardian(guardians[1], 16741936496, 0);
      const guardiansBefore = (
        await accountRecoveryModule.getSmartAccountSettings(deployer.address)
      ).guardiansCount;

      await ethers.provider.send("evm_setNextBlockTimestamp", [
        16741936496 + 1000,
      ]);

      await accountRecoveryModule
        .connect(eve)
        .removeExpiredGuardian(guardians[1], deployer.address);

      const guardiansAfter = (
        await accountRecoveryModule.getSmartAccountSettings(deployer.address)
      ).guardiansCount;

      expect(guardiansAfter).to.equal(guardiansBefore - 1);

      const guardianTimeFrame = await accountRecoveryModule.getGuardianParams(
        guardians[1],
        deployer.address
      );
      expect(guardianTimeFrame.validUntil).to.equal(0);
      expect(guardianTimeFrame.validAfter).to.equal(0);
    });

    it("Reverts if trying remove the guardian that is not expired yet", async () => {
      const { accountRecoveryModule, guardians } = await setupTests();

      await accountRecoveryModule.addGuardian(guardians[1], 16741936496, 0);
      const guardiansBefore = (
        await accountRecoveryModule.getSmartAccountSettings(deployer.address)
      ).guardiansCount;

      await expect(
        accountRecoveryModule.removeExpiredGuardian(
          guardians[1],
          deployer.address
        )
      )
        .to.be.revertedWith("GuardianNotExpired")
        .withArgs(guardians[1], deployer.address);

      const guardiansAfter = (
        await accountRecoveryModule.getSmartAccountSettings(deployer.address)
      ).guardiansCount;

      expect(guardiansAfter).to.equal(guardiansBefore);
    });

    it("Reverts if guardian has not been set", async () => {
      const { accountRecoveryModule, guardians } = await setupTests();

      // no guardians are set for deployer
      const guardianToRemove = guardians[1];

      await expect(
        accountRecoveryModule.removeExpiredGuardian(
          guardianToRemove,
          deployer.address
        )
      )
        .to.be.revertedWith("GuardianNotSet")
        .withArgs(guardianToRemove, deployer.address);
    });
  });

  describe("changeGuardianParams", async () => {
    it("Can change Guardian params and event is emitted", async () => {
      const { accountRecoveryModule, guardians, defaultSecurityDelay } = await setupTests();

      const validUntilBefore = 16741936496;
      const validAfterBefore = 0;
      await accountRecoveryModule.addGuardian(
        guardians[1],
        validUntilBefore,
        validAfterBefore
      );
      await accountRecoveryModule.setSecurityDelay(defaultSecurityDelay);

      const validUntilAfter = validUntilBefore - 100;
      const validAfterAfter = validAfterBefore + 100;

      // by some reason blockchain timestamp for the txn is 1 sec higher
      const nowPlusSecurityDelay = defaultSecurityDelay + 1 + (await ethers.provider.getBlock("latest")).timestamp;
      const expectedOnchainValidAfter = validAfterAfter > nowPlusSecurityDelay ? validAfterAfter : nowPlusSecurityDelay;

      const newTimeFrame = {
        validUntil: validUntilAfter,
        validAfter: expectedOnchainValidAfter,
      };

      const changeTxn = await accountRecoveryModule.changeGuardianParams(
        guardians[1],
        validUntilAfter,
        validAfterAfter
      );
      expect(changeTxn)
        .to.emit(accountRecoveryModule, "GuardianChanged")
        .withArgs(deployer.address, guardians[1], newTimeFrame);

      const guardianTimeFrame = await accountRecoveryModule.getGuardianParams(
        guardians[1],
        deployer.address
      );

      expect(guardianTimeFrame.validUntil).to.not.equal(validUntilBefore);
      expect(guardianTimeFrame.validAfter).to.not.equal(validAfterBefore);
      expect(guardianTimeFrame.validUntil).to.equal(validUntilAfter);
      expect(guardianTimeFrame.validAfter).to.equal(expectedOnchainValidAfter);
    });
  });

  
  describe("setThreshold", async () => {
    let accountRecoveryModuleWithGuardiansForDeployer: Contract;
    before(async () => {
      const { accountRecoveryModule, guardians } = await setupTests();
      await accountRecoveryModule.addGuardian(guardians[0], 16741936496, 0);
      await accountRecoveryModule.addGuardian(guardians[1], 16741936496, 0);
      await accountRecoveryModule.addGuardian(guardians[2], 16741936496, 0);
      await accountRecoveryModule.setThreshold(3);
      accountRecoveryModuleWithGuardiansForDeployer = accountRecoveryModule;
    });

    it("Can set a new threshold", async () => {
      const currentThreshold = (
        await accountRecoveryModuleWithGuardiansForDeployer.getSmartAccountSettings(deployer.address)
      ).recoveryThreshold;
      const newThreshold = currentThreshold - 1;
      const setThresholdTxn = await accountRecoveryModuleWithGuardiansForDeployer.setThreshold(newThreshold);
      expect(setThresholdTxn)
        .to.emit(accountRecoveryModuleWithGuardiansForDeployer, "ThresholdChanged")
        .withArgs(deployer.address, newThreshold);
      const newThresholdAfter = (
        await accountRecoveryModuleWithGuardiansForDeployer.getSmartAccountSettings(deployer.address)
      ).recoveryThreshold;
      expect(newThresholdAfter).to.equal(newThreshold); 
    });

    it("Reverts for zero threshold", async () => {
      await expect(
        accountRecoveryModuleWithGuardiansForDeployer.setThreshold(0)
      ).to.be.revertedWith("ZeroThreshold");
    });

    it("Reverts if threshold is more than number of guardians", async () => {
      const currentNumberOfGuardians = (
        await accountRecoveryModuleWithGuardiansForDeployer.getSmartAccountSettings(deployer.address)
      ).guardiansCount;
      await expect(
        accountRecoveryModuleWithGuardiansForDeployer.setThreshold(currentNumberOfGuardians + 1)
      ).to.be.revertedWith("ThresholdTooHigh");
    });
  });


  describe("setSecurityDelay", async () => {
    it("Can set security delay and event is emitted", async () => {
      const { accountRecoveryModule, defaultSecurityDelay } = await setupTests();

      const newSecurityDelay = defaultSecurityDelay + 1000;
      const setSecurityDelayTxn = await accountRecoveryModule.setSecurityDelay(newSecurityDelay);
      expect(setSecurityDelayTxn)
        .to.emit(accountRecoveryModule, "SecurityDelayChanged")
        .withArgs(deployer.address, newSecurityDelay);
      const newSecurityDelayAfter = (
        await accountRecoveryModule.getSmartAccountSettings(deployer.address)
      ).securityDelay;
      expect(newSecurityDelayAfter).to.equal(newSecurityDelay);
    });
  });

  // for the execution stage (all methods not related to validateUserOp) custom errors can be used
  // make the according explanation in the smart contract header

  
});
