import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { keccak256 } from "ethers/lib/utils";
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
  makeMultiSignedUserOp,
  makeUnsignedUserOp,
} from "../utils/userOp";

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
  ] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(
    async ({ deployments, getNamedAccounts }) => {
      await deployments.fixture();
      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const mockToken = await getMockToken();
      const entryPoint = await getEntryPoint();

      const ecdsaModule = await getEcdsaOwnershipRegistryModule();
      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [await smartAccountOwner.getAddress()]
        );
      const smartAccountDeploymentIndex = 0;
      const userSA = await getSmartAccountWithModule(
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

      // fill acct balance
      await deployer.sendTransaction({
        to: userSA.address,
        value: ethers.utils.parseEther("10"),
      });
      await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

      // deploy Social Recovery Module
      const accountRecoveryModule = await (
        await ethers.getContractFactory("AccountRecoveryModule")
      ).deploy();

      const defaultSecurityDelay = 150;
      // enable and setup Social Recovery Module
      const socialRecoverySetupData =
        accountRecoveryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [
            [
              keccak256(alice.address),
              keccak256(bob.address),
              keccak256(charlie.address),
            ],
            [16741936496, 16741936496, 16741936496],
            [0, 0, 0],
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
      await entryPoint.handleOps([setupAndEnableUserOp], alice.address);
      return {
        entryPoint: entryPoint,
        smartAccountImplementation: await getSmartAccountImplementation(),
        smartAccountFactory: await getSmartAccountFactory(),
        mockToken: mockToken,
        ecdsaModule: ecdsaModule,
        userSA: userSA,
        accountRecoveryModule: accountRecoveryModule,
        verifyingPaymaster: await getVerifyingPaymaster(
          deployer,
          verifiedSigner
        ),
        defaultSecurityDelay: defaultSecurityDelay,
      };
    }
  );

  /**
   * The delayed Social Recovery flow is the following:
   * 1. The recovery request with a proper number of signatures is submitted via
   * the userOp that calls the accountRecoveryModule.submitRecoveryRequest() function using the
   * executeCall() function of the userSA.
   * At this step social recovery module is used for both validation (check signatures) and
   * execution (SA.executeCall => AccountRecoveryModule.submitRecoveryRequest).
   * 2. After the delay has passed, the recovery request can be executed by anyone via the
   * userOp that calls the validationModule.chavalidationModul method.
   * At this step, Social Recovery Module is only used for validation: check if the request
   * with the appropriate calldata has been submitted and the delay has passed. Then the calldata
   * (that describes) the call to one of the validation modules, like ECDSA module, is executed.
   * This call will change the party that is authorized to sign userOp (signer key). This userOp
   * doesn't require any signature at all.
   */

  it("Can submit a recovery request and execute it after a proper delay", async () => {
    const {
      entryPoint,
      mockToken,
      userSA,
      accountRecoveryModule,
      ecdsaModule,
      defaultSecurityDelay,
    } = await setupTests();

    console.log(
      "social recovery module address: ",
      accountRecoveryModule.address
    );
    console.log(
      "alice address: %s hash: %s",
      alice.address,
      keccak256(alice.address)
    );
    console.log(
      "bob address: %s hash: %s",
      bob.address,
      keccak256(bob.address)
    );
    console.log(
      "charlie address: %s hash1: %s",
      charlie.address,
      keccak256(charlie.address)
    );

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
      "executeCall",
      [
        ecdsaModule.address,
        ethers.utils.parseEther("0"),
        ecdsaModule.interface.encodeFunctionData("transferOwnership", [
          newOwner.address,
        ]),
      ]
    );

    const userOp = await makeMultiSignedUserOp(
      "executeCall",
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
      "executeCall",
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
      entryPoint.handleOps([executeRecoveryRequestUserOp], alice.address, {
        gasLimit: 10000000,
      })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA22 expired or not due");

    await ethers.provider.send("evm_increaseTime", [defaultSecurityDelay + 12]);
    await ethers.provider.send("evm_mine", []);

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
  /*
  describe("initForSmartAccount", async () => {
    it("Successfully inits the Smart Account, by adding guardians and settings", async () => {});

    it("reverts if the SA has already been initialized", async () => {});

    it("reverts if the threshold provided is > then # of guardians", async () => {});

    it("reverts if the wrong amount of parameters provided", async () => {});

    it("reverts if 0 guardians provided", async () => {});

    it("reverts if at least one guardian is a zero address", async () => {});

    it("can change from ecdsa to passkeys when making recovery", async () => {});
  });

  describe("submitRecoveryRequest", async () => {});

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
        "executeCall",
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

      const eveTimeFrame = await accountRecoveryModule.getGuardianDetails(
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
