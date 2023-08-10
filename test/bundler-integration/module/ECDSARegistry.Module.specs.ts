import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { makeEcdsaModuleUserOp, getUserOpHash } from "../../utils/userOp";
import {
  getEntryPoint,
  getSmartAccountFactory,
  getEcdsaOwnershipRegistryModule,
  deployContract,
  getMockToken,
  getSmartAccountWithModule,
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
    const saFactory = await getSmartAccountFactory();
    const ecdsaRegistryModule = await getEcdsaOwnershipRegistryModule();
    const mockToken = await getMockToken();

    const ecdsaOwnershipSetupData =
      ecdsaRegistryModule.interface.encodeFunctionData("initForSmartAccount", [
        smartAccountOwner.address,
      ]);
    const userSA = await getSmartAccountWithModule(
      ecdsaRegistryModule.address,
      ecdsaOwnershipSetupData,
      smartAccountDeploymentIndex
    );

    const tokensToMint = ethers.utils.parseEther("100");
    await mockToken.mint(userSA.address, tokensToMint.toString());
    await mockToken.mint(bob.address, tokensToMint.toString());

    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("60"),
    });

    await deployer.sendTransaction({
      to: smartAccountOwner.address,
      value: ethers.utils.parseEther("60"),
    });

    const randomContractCode = `
            contract random {
                function returnAddress() public view returns(address){
                    return address(this);
                }
            }
            `;
    const randomContract = await deployContract(deployer, randomContractCode, {
      evmVersion: "london",
    });

    return {
      entryPoint: entryPoint,
      saFactory: saFactory,
      ecdsaRegistryModule: ecdsaRegistryModule,
      ecdsaOwnershipSetupData: ecdsaOwnershipSetupData,
      randomContract: randomContract,
      userSA: userSA,
      mockToken: mockToken,
    };
  });

  describe("transferOwnership: ", async () => {
    it("Call transferOwnership from userSA and it successfully changes owner ", async () => {
      const { ecdsaRegistryModule, entryPoint, userSA } = await setupTests();
      // Calldata to set Bob as owner
      const txnData1 = ecdsaRegistryModule.interface.encodeFunctionData(
        "transferOwnership",
        [bob.address]
      );
      const userOp = await makeEcdsaModuleUserOp(
        "executeCall",
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
          "executeCall",
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
          "executeCall",
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
