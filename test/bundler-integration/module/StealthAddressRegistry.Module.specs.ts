import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
  makeStealthAddressModuleUserOp,
  getUserOpHash,
  fillUserOp,
} from "../../utils/userOp";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  getEntryPoint,
  getStakedSmartAccountFactory,
  getMockToken,
} from "../../utils/setupHelper";
import {
  getStealthAddressFromSigner,
  getAggregateSig,
} from "../../utils/stealthUtil";

describe("StealthAddress Registry Module (with Bundler):", async () => {
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

    const stealthAggregateSignature = await (
      await ethers.getContractFactory("StealthAggreagteSignature", {})
    ).deploy();
    const stealthRegistryModule = await (
      await ethers.getContractFactory("StealthAddressRegistryModule", {
        libraries: {
          StealthAggreagteSignature: stealthAggregateSignature.address,
        },
      })
    ).deploy();
    const mockToken = await getMockToken();

    const stealthInfo = await getStealthAddressFromSigner(smartAccountOwner);

    const stealthRegistryModuleSetupData =
      stealthRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [
          stealthInfo.stealthAddress,
          stealthInfo.stealthPub,
          stealthInfo.dhkey,
          stealthInfo.ephemeralPub,
          stealthInfo.stealthPrefix,
          stealthInfo.dhkeyPrefix,
          stealthInfo.ephemeralPrefix,
        ]
      );

    const deploymentData = saFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [
        stealthRegistryModule.address,
        stealthRegistryModuleSetupData,
        smartAccountDeploymentIndex,
      ]
    );

    const expectedSmartAccountAddress =
      await saFactory.getAddressForCounterFactualAccount(
        stealthRegistryModule.address,
        stealthRegistryModuleSetupData,
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

    const deploymentUserOp = await fillUserOp(
      {
        sender: expectedSmartAccountAddress,
        initCode: ethers.utils.hexConcat([saFactory.address, deploymentData]),
        callData: "0x",
        callGasLimit: 1_000_000,
        verificationGasLimit: 4_000_000,
        preVerificationGas: 50000,
      },
      entryPoint
    );

    const provider = entryPoint?.provider;
    const chainId = await provider!.getNetwork().then((net) => net.chainId);
    const userOpHash = getUserOpHash(
      deploymentUserOp,
      entryPoint.address,
      chainId
    );
    const sig = await getAggregateSig(
      smartAccountOwner,
      stealthInfo.hashSharedSecret,
      ethers.utils.arrayify(userOpHash)
    );
    const signature = ethers.utils.hexConcat(["0x01", sig]);

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [signature, stealthRegistryModule.address]
    );

    deploymentUserOp.signature = signatureWithModuleAddress;
    await environment.sendUserOperation(deploymentUserOp, entryPoint.address);

    const userSA = await ethers.getContractAt(
      "SmartAccount",
      expectedSmartAccountAddress
    );

    return {
      entryPoint,
      saFactory,
      stealthAggregateSignature,
      stealthRegistryModule,
      stealthRegistryModuleSetupData,
      userSA,
      mockToken,
      stealthInfo,
    };
  });

  describe("validateUserOp(): ", async () => {
    it("Returns SIG_VALIDATION_SUCCESS for a valid UserOp and valid userOpHash ", async () => {
      const {
        entryPoint,
        stealthRegistryModule,
        userSA,
        stealthInfo,
        mockToken,
      } = await setupTests();
      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("3.5672");

      const txnData = mockToken.interface.encodeFunctionData("transfer", [
        bob.address,
        tokenAmountToTransfer.toString(),
      ]);

      const userOp = await makeStealthAddressModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        stealthRegistryModule.address,
        stealthInfo.hashSharedSecret,
        1,
        {
          preVerificationGas: 50000,
        }
      );

      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const userOpHash = getUserOpHash(userOp, entryPoint.address, chainId);

      const res = await stealthRegistryModule.validateUserOp(
        userOp,
        userOpHash
      );
      expect(res).to.be.equal(SIG_VALIDATION_SUCCESS);
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
