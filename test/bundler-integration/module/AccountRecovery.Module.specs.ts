import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { makeEcdsaModuleUserOp, makeUnsignedUserOp } from "../../utils/userOp";
import { makeMultiSignedUserOpWithGuardiansList, makeHashToGetGuardianId } from "../../utils/accountRecovery";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../../utils/setupHelper";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";

describe("Account Recovery Module (via Bundler)", async () => {
  let [
    deployer,
    smartAccountOwner,
    alice,
    bob,
    charlie,
    verifiedSigner,
    eve,
    fox,
    newOwner,
  ] = [] as SignerWithAddress[];

  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [
      deployer,
      smartAccountOwner,
      alice,
      bob,
      charlie,
      verifiedSigner,
      eve,
      fox,
      newOwner,
    ] = await ethers.getSigners();
  });

  afterEach(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    await Promise.all([
      environment.revert(environment.defaultSnapshot!),
      environment.resetBundler(),
    ]);
  });

  const setupTests = deployments.createFixture(
    async ({ deployments, getNamedAccounts }) => {
      const controlMessage = "ACCOUNT RECOVERY GUARDIAN SECURE MESSAGE";

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

      // top up acct balance
      await deployer.sendTransaction({
        to: userSA.address,
        value: ethers.utils.parseEther("10"),
      });
      await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

      // deploy Social Recovery Module
      const accountRecoveryModule = await (
        await ethers.getContractFactory("AccountRecoveryModule")
      ).deploy();

      const defaultSecurityDelay = 15;

      const messageHashBytes = ethers.utils.arrayify(makeHashToGetGuardianId(controlMessage, userSA.address));

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
        ecdsaModule.address,
        {
          preVerificationGas: 70000,
        }
      );

      // initForSmartAccount userOp goes thru bundler as well
      await environment.sendUserOperation(
        setupAndEnableUserOp,
        entryPoint.address
      );

      return {
        entryPoint: entryPoint,
        smartAccountImplementation: await getSmartAccountImplementation(),
        smartAccountFactory: await getSmartAccountFactory(),
        mockToken: mockToken,
        ecdsaModule: ecdsaModule,
        userSA: userSA,
        accountRecoveryModule: accountRecoveryModule,
        defaultSecurityDelay: defaultSecurityDelay,
        controlMessage: controlMessage,
      };
    }
  );

  const delay = async function (ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  it("Can submit a recovery request and execute it after a proper delay", async () => {
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

    const submitRequestUserOp = await makeMultiSignedUserOpWithGuardiansList(
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
      accountRecoveryModule.address,
      {
        preVerificationGas: 70000,
      }
    );

    // submit recovery request goes thru bundler
    await environment.sendUserOperation(
      submitRequestUserOp,
      entryPoint.address
    );

    const recoveryRequest = await accountRecoveryModule.getRecoveryRequest(
      userSA.address
    );
    expect(recoveryRequest.callDataHash).to.equal(
      ethers.utils.keccak256(recoveryRequestCallData)
    );
    expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
      smartAccountOwner.address
    );

    // THIS IS NOT POSSIBLE YET
    // await ethers.provider.send("evm_increaseTime", [defaultSecurityDelay + 12]);
    // await ethers.provider.send("evm_mine", []);

    // USING THIS HACK INSTEAD
    console.log(
      "Waiting for the security delay of %i seconds to pass...",
      defaultSecurityDelay + 1
    );
    await delay((defaultSecurityDelay + 1) * 1000);

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
      accountRecoveryModule.address,
      {
        preVerificationGas: 70000,
      }
    );

    // execute recovery request goes thru bundler
    await environment.sendUserOperation(
      executeRecoveryRequestUserOp,
      entryPoint.address
    );

    expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
      newOwner.address
    );
    expect(await ecdsaModule.getOwner(userSA.address)).to.not.equal(
      smartAccountOwner.address
    );
  });
});
