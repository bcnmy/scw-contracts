import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { encodeTransfer } from "../../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import {
  makeEcdsaModuleUserOp,
  makeEcdsaModuleUserOp2D,
  makeEcdsaModuleUserOpWithPaymaster,
} from "../../utils/userOp";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { UserOperation } from "../../utils/userOperation";

async function randomizeAndSendOperations(
  ops: UserOperation[],
  address: string,
  environment: BundlerTestEnvironment
) {
  const shuffledOps = ops.sort(() => Math.random() - 0.5);
  for (const op of shuffledOps) {
    await environment.sendUserOperation(op, address);
  }
}

describe("Modular Smart Account Basics (with Bundler)", async () => {
  let deployer: SignerWithAddress,
    smartAccountOwner: SignerWithAddress,
    charlie: SignerWithAddress,
    verifiedSigner: SignerWithAddress;
  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [deployer, smartAccountOwner, charlie, verifiedSigner] =
      await ethers.getSigners();
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
      await deployments.fixture();

      const mockToken = await getMockToken();

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

      await deployer.sendTransaction({
        to: userSA.address,
        value: ethers.utils.parseEther("10"),
      });

      await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

      return {
        entryPoint: await getEntryPoint(),
        smartAccountImplementation: await getSmartAccountImplementation(),
        smartAccountFactory: await getSmartAccountFactory(),
        mockToken: mockToken,
        ecdsaModule: ecdsaModule,
        userSA: userSA,
        verifyingPaymaster: await getVerifyingPaymaster(
          deployer,
          verifiedSigner
        ),
      };
    }
  );

  it("Can send an ERC20 Transfer and native transfer userOps using 2D nonce", async () => {
    const userOp1NonceKey = 5; // Nonce keys are used for 2D nonces and otherwise 0
    const userOp2NonceKey = 10; // Nonce keys are used for 2D nonces and otherwise 0
    const { entryPoint, mockToken, userSA, ecdsaModule } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const userOp1 = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address,
      {
        preVerificationGas: 50000,
      },
      userOp1NonceKey
    );
    console.log("userOp1.nonce", userOp1.nonce.toString());

    const charlieBalanceBefore = await charlie.getBalance();
    const amountToTransfer = ethers.utils.parseEther("0.5345");

    const userOp2 = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [charlie.address, amountToTransfer, "0x"],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address,
      {
        preVerificationGas: 50000,
      },
      userOp2NonceKey
    );
    console.log("userOp2.nonce", userOp1.nonce.toString());

    await Promise.all([
      environment.sendUserOperation(userOp1, entryPoint.address),
      environment.sendUserOperation(userOp2, entryPoint.address),
    ]);

    // can use either of these

    /* await randomizeAndSendOperations(
      [userOp1, userOp2],
      entryPoint.address,
      environment
    ); */

    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );

    expect(await charlie.getBalance()).to.equal(
      charlieBalanceBefore.add(amountToTransfer)
    );
  });
});
