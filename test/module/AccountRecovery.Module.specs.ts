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
  makeMultiSignedUserOpWithGuardiansList,
  makeUnsignedUserOp,
  getUserOpHash
} from "../utils/userOp";
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
            await guardian.signMessage(messageHashBytes)
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
      await entryPoint.handleOps([setupAndEnableUserOp], refundReceiver.address);

      // create a new account which is not yet initialized
      const ecdsaOwnershipSetupDataAlice =
        ecdsaModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [alice.address]
        );
      
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

  it("Can submit a recovery request and execute it only after a proper delay (no bundler)", async () => {
    const {
      entryPoint,
      mockToken,
      userSA,
      accountRecoveryModule,
      ecdsaModule,
      defaultSecurityDelay,
      controlMessage,
    } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const arrayOfSigners = [alice, bob, charlie];
    arrayOfSigners.sort((a, b) => a.address.localeCompare(b.address));

    expect(
      await userSA.isModuleEnabled(accountRecoveryModule.address)
    ).to.equal(true);

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

    // fast foprward
    await ethers.provider.send("evm_increaseTime", [defaultSecurityDelay + 12]);
    await ethers.provider.send("evm_mine", []);

    // now everything should work
    await entryPoint.handleOps([executeRecoveryRequestUserOp], alice.address, {
      gasLimit: 10000000,
    });
    expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
      newOwner.address
    );
    expect(await ecdsaModule.getOwner(userSA.address)).to.not.equal(
      smartAccountOwner.address
    );
  });

  
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
            await guardian.signMessage(messageHashBytes)
        )
      );

      const bobTimeFrame = [16741936493, 1];
      const eveTimeFrame = [16741936494, 2];
      const foxTimeFrame = [16741936495, 3];

      const timeFrames = [
        bobTimeFrame,
        eveTimeFrame,
        foxTimeFrame,
      ];

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [
            guardians,
            timeFrames,
            recoveryThreshold,
            defaultSecurityDelay,
          ]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        aliceSA.address,
        alice,
        entryPoint,
        ecdsaModule.address
      );
      await entryPoint.handleOps([setupAndEnableUserOp], refundReceiver.address);

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

      expect(await accountRecoveryModule.getGuardianParams(guardians[0], aliceSA.address)).to.deep.equal(bobTimeFrame);
      expect(await accountRecoveryModule.getGuardianParams(guardians[1], aliceSA.address)).to.deep.equal(eveTimeFrame);
      expect(await accountRecoveryModule.getGuardianParams(guardians[2], aliceSA.address)).to.deep.equal(foxTimeFrame);

    });

    it("reverts if the SA has already been initialized", async () => {
      const {
        entryPoint,
        userSA,
        accountRecoveryModule,
        ecdsaModule,
        defaultSecurityDelay,
        controlMessage,
        chainId
      } = await setupTests();

      const recoveryThreshold = 2;
      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash); // same should happen when signing with guardian private key

      const guardians = await Promise.all(
        [bob, eve, fox].map(
          async (guardian): Promise<string> =>
            await guardian.signMessage(messageHashBytes)
        )
      );

      const bobTimeFrame = [16741936493, 1];
      const eveTimeFrame = [16741936494, 2];
      const foxTimeFrame = [16741936495, 3];

      const timeFrames = [
        bobTimeFrame,
        eveTimeFrame,
        foxTimeFrame,
      ];

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [
            guardians,
            timeFrames,
            recoveryThreshold,
            defaultSecurityDelay,
          ]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const tx = await entryPoint.handleOps([setupAndEnableUserOp], refundReceiver.address, {
        gasLimit: 10000000,
      });

      const errorData = ethers.utils.hexConcat([
        ethers.utils.id("AlreadyInitedForSmartAccount(address)").slice(0,10),
        ethers.utils.hexZeroPad(userSA.address, 32),
      ]);

      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason")
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
        chainId
      } = await setupTests();
      
      const recoveryThreshold = 5;
      const messageHash = ethers.utils.id(controlMessage);
      const messageHashBytes = ethers.utils.arrayify(messageHash); // same should happen when signing with guardian private key

      const guardians = await Promise.all(
        [bob, eve, fox].map(
          async (guardian): Promise<string> =>
            await guardian.signMessage(messageHashBytes)
        )
      );

      const bobTimeFrame = [16741936493, 1];
      const eveTimeFrame = [16741936494, 2];
      const foxTimeFrame = [16741936495, 3];

      const timeFrames = [
        bobTimeFrame,
        eveTimeFrame,
        foxTimeFrame,
      ];

      const accountRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [
            guardians,
            timeFrames,
            recoveryThreshold,
            defaultSecurityDelay,
          ]
        );
      const setupAndEnableUserOp = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [accountRecoveryModule.address, accountRecoverySetupData],
        aliceSA.address,
        alice,
        entryPoint,
        ecdsaModule.address
      );
      const tx = await entryPoint.handleOps([setupAndEnableUserOp], refundReceiver.address);
      
      const errorData = ethers.utils.hexConcat([
        ethers.utils.id("ThresholdTooHigh(uint8,uint256)").slice(0,10),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(recoveryThreshold), 32),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(guardians.length), 32),
      ]);

      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason")
      .withArgs(
        getUserOpHash(setupAndEnableUserOp, entryPoint.address, chainId),
        setupAndEnableUserOp.sender,
        setupAndEnableUserOp.nonce,
        errorData
      );
    });

    it("reverts if the wrong amount of parameters provided", async () => {});

    it("reverts if 0 guardians provided", async () => {});

    it("reverts if at least one guardian is a zero address", async () => {});

    it("can change from ecdsa to passkeys when making recovery", async () => {});
  });

  /*

  describe("submitRecoveryRequest", async () => {
    // what if zero calldata is provided

  });

  describe("renounceRecoveryRequest", async () => {});

  describe("Validation Flow", async () => {
    it("Should immediately execute recovery request when delay is 0", async () => {});

    it("Should revert userOp if the dalay is >0 and the calldata is not for submitting request", async () => {});

    it("Should revert if execution calldata doesn't match the submitted request", async () => {});

    it("Should revert executing the request if the delay has not passed yet", async () => {});

    it("Should revert if at least one guardian is expired", async () => {});

    it("Should revert if at least one guardian is not yet active", async () => {});

    it("Should revert if expired and not yet active cases  intersect", async () => {});

    it("Should revert if at least one signature is invalid", async () => {});

    it("Should revert if guardians are not unique", async () => {});

    it("Events are emitted properly", async () => {});
  });
  */

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
  */
});
