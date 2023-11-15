import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
  makeEcdsaModuleUserOp,
  getUserOpHash,
  fillAndSign,
} from "../../utils/userOp";
import {
  getEntryPoint,
  getEcdsaOwnershipRegistryModule,
  getMockToken,
  getStakedSmartAccountFactory,
} from "../../utils/setupHelper";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("OrgUserAdmin PoC (with Bundler):", async () => {
  let [deployer, smartAccountOwner, bob] = [] as SignerWithAddress[];
  const smartAccountDeploymentIndex = 0;
  const SIG_VALIDATION_SUCCESS = 0;
  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [deployer, smartAccountOwner, bob] = await ethers.getSigners();
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

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const saFactory = await getStakedSmartAccountFactory();
    const ecdsaRegistryModule = await getEcdsaOwnershipRegistryModule();
    const mockToken = await getMockToken();

    const ecdsaOwnershipSetupData =
      ecdsaRegistryModule.interface.encodeFunctionData("initForSmartAccount", [
        smartAccountOwner.address,
      ]);

    const deploymentData = saFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [
        ecdsaRegistryModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex,
      ]
    );

    const expectedSmartAccountAddress =
      await saFactory.getAddressForCounterFactualAccount(
        ecdsaRegistryModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

    const tokensToMint = ethers.utils.parseEther("100");
    await mockToken.mint(expectedSmartAccountAddress, tokensToMint.toString());
    await mockToken.mint(bob.address, tokensToMint.toString());

    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("60"),
    });

    await deployer.sendTransaction({
      to: smartAccountOwner.address,
      value: ethers.utils.parseEther("60"),
    });

    // deployment userOp
    const deploymentUserOp = await fillAndSign(
      {
        sender: expectedSmartAccountAddress,
        callGasLimit: 1_000_000,
        initCode: ethers.utils.hexConcat([saFactory.address, deploymentData]),
        callData: "0x",
        preVerificationGas: 50000,
      },
      smartAccountOwner,
      entryPoint,
      "nonce"
    );

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [deploymentUserOp.signature, ecdsaRegistryModule.address]
    );

    deploymentUserOp.signature = signatureWithModuleAddress;

    await environment.sendUserOperation(deploymentUserOp, entryPoint.address);

    const userSA = await ethers.getContractAt(
      "SmartAccount",
      expectedSmartAccountAddress
    );

    const orgUserAdminModule = await (
      await ethers.getContractFactory("OrgUserAdminModule")
    ).deploy();

    const enableModuleUserOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [orgUserAdminModule.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaRegistryModule.address,
      {
        preVerificationGas: 50000,
      }
    );
    await environment.sendUserOperation(enableModuleUserOp, entryPoint.address);

    expect(await userSA.isModuleEnabled(orgUserAdminModule.address)).to.equal(
      true
    );

    // get the function selector of mockToken.transfer(address,uint256)
    const initOrgUserAdminModuleUserOp = await makeEcdsaModuleUserOp(
      "execute",
      [
        orgUserAdminModule.address,
        0,
        orgUserAdminModule.interface.encodeFunctionData("initMappings", [
          mockToken.address,
          ethers.utils.id("transfer(address,uint256)").substring(0, 10),
        ]),
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaRegistryModule.address,
      {
        preVerificationGas: 50000,
      }
    );
    await environment.sendUserOperation(
      initOrgUserAdminModuleUserOp,
      entryPoint.address
    );

    return {
      entryPoint: entryPoint,
      saFactory: saFactory,
      ecdsaRegistryModule: ecdsaRegistryModule,
      ecdsaOwnershipSetupData: ecdsaOwnershipSetupData,
      userSA: userSA,
      mockToken: mockToken,
      orgUserAdminModule: orgUserAdminModule,
    };
  });

  describe("validateUserOp(): ", async () => {
    it("Returns SIG_VALIDATION_SUCCESS for a valid UserOp and valid userOpHash ", async () => {
      const {
        ecdsaRegistryModule,
        entryPoint,
        userSA,
        mockToken,
        orgUserAdminModule,
      } = await setupTests();
      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("3.5672");

      const txnData = mockToken.interface.encodeFunctionData("transfer", [
        bob.address,
        tokenAmountToTransfer.toString(),
      ]);

      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        orgUserAdminModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);

      expect(await mockToken.balanceOf(bob.address)).to.equal(
        bobBalanceBefore.add(tokenAmountToTransfer)
      );
      expect(await mockToken.balanceOf(userSA.address)).to.equal(
        userSABalanceBefore.sub(tokenAmountToTransfer)
      );
    });
  });
});
