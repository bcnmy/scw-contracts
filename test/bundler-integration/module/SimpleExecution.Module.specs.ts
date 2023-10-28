import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { makeEcdsaModuleUserOp } from "../../utils/userOp";
import {
  getEntryPoint,
  getEcdsaOwnershipRegistryModule,
  getMockToken,
  getStakedSmartAccountFactory,
  getSimpleExecutionModule,
  getSmartAccountWithModule,
  getSmartAccountFactory,
  getSmartAccountImplementation,
} from "../../utils/setupHelper";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Transaction } from "../../../src/utils/execution";
import { BigNumber } from "ethers";

const feeCollector = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
const AddressOne = "0x0000000000000000000000000000000000000001";

describe("ECDSA Registry Validation + Simple Execution Module (with Bundler):", async () => {
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

    const mockToken = await getMockToken();
    const entryPoint = await getEntryPoint();
    const saFactory = await getStakedSmartAccountFactory();
    const ecdsaRegistryModule = await getEcdsaOwnershipRegistryModule();

    const ecdsaOwnershipSetupData =
      ecdsaRegistryModule.interface.encodeFunctionData("initForSmartAccount", [
        await smartAccountOwner.getAddress(),
      ]);

    const userSA = await getSmartAccountWithModule(
      ecdsaRegistryModule.address,
      ecdsaOwnershipSetupData,
      smartAccountDeploymentIndex
    );

    // send funds to userSA and mint tokens
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    const mockWrapper = await (
      await ethers.getContractFactory("MockWrapper")
    ).deploy();

    // deploy simple execution module and enable it in the smart account
    const delegateCallModule = await (
      await ethers.getContractFactory("SimpleExecutionModule")
    ).deploy();
    // ^ or use await getSimpleExecutionModule();

    const userOp1 = await makeEcdsaModuleUserOp(
      "enableModule",
      [delegateCallModule.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaRegistryModule.address
    );

    await entryPoint.handleOps([userOp1], bob.address);

    const tokensToMint = ethers.utils.parseEther("100");
    await mockToken.mint(bob.address, tokensToMint.toString());

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      saFactory: saFactory,
      ecdsaRegistryModule: ecdsaRegistryModule,
      ecdsaOwnershipSetupData: ecdsaOwnershipSetupData,
      delegateCallModule: delegateCallModule,
      mockWrapper: mockWrapper,
      userSA: userSA,
      mockToken: mockToken,
    };
  });

  describe("delegatecall using enabled module ", async () => {
    it("validate using ecdsa and call enabled delegate call module for simple execution", async () => {
      const {
        ecdsaRegistryModule,
        entryPoint,
        userSA,
        delegateCallModule,
        mockWrapper,
        mockToken,
      } = await setupTests();

      // simple execution module should have been enabled
      expect(await userSA.isModuleEnabled(delegateCallModule.address)).to.equal(
        true
      );

      // ecdsa module should have been enabled as default auth module
      expect(
        await userSA.isModuleEnabled(ecdsaRegistryModule.address)
      ).to.equal(true);

      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const feeCollctorBalanceBefore = await mockToken.balanceOf(feeCollector);

      const totalTokensToTransfer = ethers.utils.parseEther("30");

      const wrapperCallData = mockWrapper.interface.encodeFunctionData(
        "interact",
        [mockToken.address, bob.address, totalTokensToTransfer]
      );

      // type Transaction without targetTxGas
      const transaction: any = {
        to: mockWrapper.address,
        value: "0",
        data: wrapperCallData,
        operation: 1, // dalegate call
      };

      // Calldata to send tokens using a wrapper
      const txnData1 = delegateCallModule.interface.encodeFunctionData(
        "execTransaction",
        [transaction]
      );
      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [delegateCallModule.address, 0, txnData1],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaRegistryModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);

      // expect(thrownError).to.deep.equal(expectedError);

      // 2/3 or totalTokensToTransfer because MockWrapper takes 1/3 as fee
      expect(await mockToken.balanceOf(bob.address)).to.equal(
        bobBalanceBefore.add(
          totalTokensToTransfer.sub(
            totalTokensToTransfer.div(BigNumber.from(3))
          )
        )
      );

      expect(await mockToken.balanceOf(userSA.address)).to.equal(
        userSABalanceBefore.sub(totalTokensToTransfer)
      );

      // mock wrapper collects 1/3 or totalTokensToTransfer as fee
      expect(await mockToken.balanceOf(feeCollector)).to.equal(
        feeCollctorBalanceBefore.add(
          totalTokensToTransfer.div(BigNumber.from(3))
        )
      );
    });
  });
});
