import { expect } from "chai";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  addLeavesForSmartAccountViaEcdsa,
  getContractCallSessionKeyParams,
} from "../../../utils/sessionKey";
import { ethers, deployments } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../../../utils/userOp";
import { encodeTransfer } from "../../../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../../../utils/setupHelper";
import { BigNumber } from "ethers";
import { UserOperation } from "../../../utils/userOperation";
import { BundlerTestEnvironment } from "../../environment/bundlerEnvironment";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("SessionKey: Contract call Session Validation Module (with Bundler)", async () => {
  let [
    deployer,
    smartAccountOwner,
    alice,
    charlie,
    verifiedSigner,
    sessionKey,
  ] = [] as SignerWithAddress[];
  const maxAmount = ethers.utils.parseEther("100");

  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [deployer, smartAccountOwner, alice, charlie, verifiedSigner, sessionKey] =
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

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();
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

    // send funds to userSA and mint tokens
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    // deploy forward flow module and enable it in the smart account
    const sessionKeyManager = await (
      await ethers.getContractFactory("SessionKeyManager")
    ).deploy();
    const userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [sessionKeyManager.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address,
      {
        preVerificationGas: 50000,
      }
    );

    await environment.sendUserOperation(userOp, entryPoint.address);

    const ccSVM = await (
      await ethers.getContractFactory("ContractCallSessionValidationModule")
    ).deploy();

    const { sessionKeyData, leafData } = await getContractCallSessionKeyParams(
      sessionKey.address,
      [
        mockToken.address,
        ethers.utils.hexDataSlice(
          ethers.utils.id("transfer(address,uint256)"),
          0,
          4
        ),
      ],
      0,
      0,
      ccSVM.address
    );

    const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
      [ethers.utils.keccak256(leafData)],
      sessionKeyManager,
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      mockToken: mockToken,
      sessionKeyManager: sessionKeyManager,
      ccSVM: ccSVM,
      sessionKeyData: sessionKeyData,
      leafData: leafData,
      merkleTree: merkleTree,
      sessionKey: sessionKey,
    };
  });

  const makeErc20TransferUserOp = async function (
    token: string,
    amount: BigNumber,
    recipient: string,
    txnValue: BigNumber,
    testParams: any = {}
  ): Promise<UserOperation> {
    const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
      "execute_ncC",
      [token, txnValue, encodeTransfer(recipient, amount.toString())],
      testParams.userSA.address,
      sessionKey,
      testParams.entryPoint,
      testParams.sessionKeyManager.address,
      0,
      0,
      testParams.ccSVM.address,
      testParams.sessionKeyData,
      testParams.merkleTree.getHexProof(
        ethers.utils.keccak256(testParams.leafData)
      ),
      {
        preVerificationGas: 50000,
      }
    );
    return transferUserOp;
  };

  it("should be able to process Session Key signed userOp", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      ccSVM,
      sessionKeyData,
      leafData,
      merkleTree,
      mockToken,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");

    const transferUserOp = await makeErc20TransferUserOp(
      mockToken.address,
      tokenAmountToTransfer,
      charlie.address,
      ethers.utils.parseEther("0"),
      {
        entryPoint,
        userSA,
        sessionKeyManager,
        ccSVM,
        sessionKeyData,
        leafData,
        merkleTree,
      }
    );

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    await environment.sendUserOperation(transferUserOp, entryPoint.address);
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });
});
