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

describe("ECDSA Registry Module (with Bundler):", async () => {
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

    return {
      entryPoint: entryPoint,
      saFactory: saFactory,
      ecdsaRegistryModule: ecdsaRegistryModule,
      ecdsaOwnershipSetupData: ecdsaOwnershipSetupData,
      userSA: userSA,
      mockToken: mockToken,
    };
  });

  describe("transferOwnership: ", async () => {
    it("Call transferOwnership from userSA and it successfully changes owner ", async () => {
      const { ecdsaRegistryModule, entryPoint, userSA } = await setupTests();
      // console.log(await userSA.getImplementation());

      // Calldata to set Bob as owner
      const txnData1 = ecdsaRegistryModule.interface.encodeFunctionData(
        "transferOwnership",
        [bob.address]
      );
      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [ecdsaRegistryModule.address, 0, txnData1],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaRegistryModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);
      expect(await ecdsaRegistryModule.getOwner(userSA.address)).to.be.equal(
        bob.address
      );
    });

    describe("renounceOwnership():", async () => {
      it("Should be able to renounce ownership and the new owner should be address(0)", async () => {
        const { ecdsaRegistryModule, entryPoint, userSA } = await setupTests();
        const txnData1 = ecdsaRegistryModule.interface.encodeFunctionData(
          "renounceOwnership",
          []
        );
        const userOp = await makeEcdsaModuleUserOp(
          "execute_ncC",
          [ecdsaRegistryModule.address, 0, txnData1],
          userSA.address,
          smartAccountOwner,
          entryPoint,
          ecdsaRegistryModule.address,
          {
            preVerificationGas: 50000,
          }
        );

        await environment.sendUserOperation(userOp, entryPoint.address);
        await expect(
          ecdsaRegistryModule.getOwner(userSA.address)
        ).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");
      });
    });

    describe("validateUserOp(): ", async () => {
      it("Returns SIG_VALIDATION_SUCCESS for a valid UserOp and valid userOpHash ", async () => {
        const { ecdsaRegistryModule, entryPoint, userSA, mockToken } =
          await setupTests();
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
          ecdsaRegistryModule.address,
          {
            preVerificationGas: 50000,
          }
        );
        // Construct userOpHash
        const provider = entryPoint?.provider;
        const chainId = await provider!.getNetwork().then((net) => net.chainId);
        const userOpHash = getUserOpHash(userOp, entryPoint.address, chainId);

        const res = await ecdsaRegistryModule.validateUserOp(
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
});
