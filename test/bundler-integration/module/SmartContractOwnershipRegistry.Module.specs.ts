import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
  getEntryPoint,
  getSmartAccountFactory,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getSmartContractOwnershipRegistryModule,
  getMockToken,
  deployContract,
} from "../../utils/setupHelper";
import { getUserOpHash, makeSARegistryModuleUserOp } from "../../utils/userOp";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";

describe("Smart Contract Ownership Registry Module (with Bundler):", async () => {
  let [deployer, baseSmartAccountOwner1, baseSmartAccountOwner2, bob] =
    [] as SignerWithAddress[];
  const smartAccountDeploymentIndex = 0;
  const SIG_VALIDATION_SUCCESS = 0;

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const saFactory = await getSmartAccountFactory();
    const smartContractOwnershipRegistryModule =
      await getSmartContractOwnershipRegistryModule();
    const ecdsaRegistryModule = await getEcdsaOwnershipRegistryModule();
    const mockToken = await getMockToken();

    const ecdsaOwnershipSetupData1 =
      ecdsaRegistryModule.interface.encodeFunctionData("initForSmartAccount", [
        baseSmartAccountOwner1.address,
      ]);
    const ecdsaOwnershipSetupData2 =
      ecdsaRegistryModule.interface.encodeFunctionData("initForSmartAccount", [
        baseSmartAccountOwner2.address,
      ]);
    const smartAccountOwnerContract1 = await getSmartAccountWithModule(
      ecdsaRegistryModule.address,
      ecdsaOwnershipSetupData1,
      smartAccountDeploymentIndex
    );
    const smartAccountOwnerContract2 = await getSmartAccountWithModule(
      ecdsaRegistryModule.address,
      ecdsaOwnershipSetupData2,
      smartAccountDeploymentIndex + 1
    );

    const smartContractOwnershipSetupData =
      smartContractOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [smartAccountOwnerContract1.address]
      );
    const userSA = await getSmartAccountWithModule(
      smartContractOwnershipRegistryModule.address,
      smartContractOwnershipSetupData,
      smartAccountDeploymentIndex + 2
    );
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("60"),
    });
    const tokensToMint = ethers.utils.parseEther("100");
    await mockToken.mint(userSA.address, tokensToMint.toString());
    await mockToken.mint(bob.address, tokensToMint.toString());

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
      smartContractOwnershipRegistryModule:
        smartContractOwnershipRegistryModule,
      ecdsaRegistryModule: ecdsaRegistryModule,
      mockToken: mockToken,
      userSA: userSA,
      smartAccountOwnerContract1: smartAccountOwnerContract1,
      smartAccountOwnerContract2: smartAccountOwnerContract2,
      smartContractOwnershipSetupData: smartContractOwnershipSetupData,
      randomContract: randomContract,
    };
  });

  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [deployer, baseSmartAccountOwner1, baseSmartAccountOwner2, bob] =
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

  describe("transferOwnership(): ", async () => {
    it("Should successfully transfer ownership to another Smart Contract Account", async () => {
      const {
        entryPoint,
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        userSA,
        smartAccountOwnerContract2,
      } = await setupTests();
      // Calldata to set smartAccountOwnerContract2 as owner
      const txnData =
        smartContractOwnershipRegistryModule.interface.encodeFunctionData(
          "transferOwnership",
          [smartAccountOwnerContract2.address]
        );
      const userOp = await makeSARegistryModuleUserOp(
        "executeCall",
        [smartContractOwnershipRegistryModule.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address,
        {
          preVerificationGas: 50000,
        }
      );
      await environment.sendUserOperation(userOp, entryPoint.address);
      expect(
        await smartContractOwnershipRegistryModule.getOwner(userSA.address)
      ).to.be.equal(smartAccountOwnerContract2.address);
    });
  });

  describe("renounceOwnership(): ", async () => {
    it("Should be able to renounce ownership and the new owner should be address(0)", async () => {
      const {
        entryPoint,
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        userSA,
      } = await setupTests();
      const txnData =
        smartContractOwnershipRegistryModule.interface.encodeFunctionData(
          "renounceOwnership",
          []
        );
      const userOp = await makeSARegistryModuleUserOp(
        "executeCall",
        [smartContractOwnershipRegistryModule.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address,
        {
          preVerificationGas: 50000,
        }
      );
      await environment.sendUserOperation(userOp, entryPoint.address);
      await expect(
        smartContractOwnershipRegistryModule.getOwner(userSA.address)
      ).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");
    });
  });

  describe("validateUserOp(): ", async () => {
    it("Should return SIG_VALIDATION_SUCCESS for a valid UserOp and valid userOpHash", async () => {
      const {
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        entryPoint,
        userSA,
        mockToken,
      } = await setupTests();
      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("3.5672");

      const txnData = mockToken.interface.encodeFunctionData("transfer", [
        bob.address,
        tokenAmountToTransfer.toString(),
      ]);
      const userOp = await makeSARegistryModuleUserOp(
        "executeCall",
        [mockToken.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address,
        {
          preVerificationGas: 50000,
        }
      );
      // Construct userOpHash
      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const userOpHash = getUserOpHash(userOp, entryPoint.address, chainId);

      const res = await smartContractOwnershipRegistryModule.validateUserOp(
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
