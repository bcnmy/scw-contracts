import { expect, use } from "chai";
import {
  enableNewTreeForSmartAccountViaEcdsa,
  getERC20SessionKeyParams,
} from "../../utils/sessionKey";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../../utils/userOp";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";

describe("SessionKey: Session Router (via Bundler)", async () => {
  let [deployer, smartAccountOwner, charlie, verifiedSigner, sessionKey] =
    [] as SignerWithAddress[];

  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [deployer, smartAccountOwner, charlie, verifiedSigner, sessionKey] =
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

  const maxAmount = ethers.utils.parseEther("100");

  const setupTests = deployments.createFixture(
    async ({ deployments, getNamedAccounts }) => {
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
      const sessionRouter = await (
        await ethers.getContractFactory("BatchedSessionRouter")
      ).deploy();

      const userOp1 = await makeEcdsaModuleUserOp(
        "enableModule",
        [sessionKeyManager.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      await entryPoint.handleOps([userOp1], charlie.address);

      const userOp2 = await makeEcdsaModuleUserOp(
        "enableModule",
        [sessionRouter.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      await entryPoint.handleOps([userOp2], charlie.address);

      const erc20SessionModule = await (
        await ethers.getContractFactory("ERC20SessionValidationModule")
      ).deploy();
      // MockProtocol contract
      const mockProtocol = await (
        await ethers.getContractFactory("MockProtocol")
      ).deploy();
      // MockProtocol SV Module
      const mockProtocolSVModule = await (
        await ethers.getContractFactory("MockProtocolSVM")
      ).deploy();

      const { sessionKeyData, leafData } = await getERC20SessionKeyParams(
        sessionKey.address,
        mockToken.address,
        mockProtocol.address,
        maxAmount,
        0,
        0,
        erc20SessionModule.address
      );

      // create leaf for the fakeswap sv module
      const { sessionKeyData: sessionKeyData2, leafData: leafData2 } =
        await getERC20SessionKeyParams(
          sessionKey.address,
          mockProtocol.address, // contract to interact with
          mockToken.address, // token to transfer to protocol
          maxAmount,
          0,
          0,
          mockProtocolSVModule.address
        );

      // build a big tree
      const leaves = [ethers.utils.keccak256(leafData)];
      for (let i = 0; i < 9999; i++) {
        if (i === 4988) {
          leaves.push(ethers.utils.keccak256(leafData2));
        }
        leaves.push(ethers.utils.keccak256(ethers.utils.randomBytes(32)));
      }

      const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
        leaves,
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
        verifyingPaymaster: await getVerifyingPaymaster(
          deployer,
          verifiedSigner
        ),
        sessionKeyManager: sessionKeyManager,
        erc20SessionModule: erc20SessionModule,
        sessionKeyData: sessionKeyData,
        leafData: leafData,
        sessionKeyData2: sessionKeyData2,
        leafData2: leafData2,
        merkleTree: merkleTree,
        sessionRouter: sessionRouter,
        mockProtocol: mockProtocol,
        mockProtocolSVM: mockProtocolSVModule,
      };
    }
  );

  it("should process Session Key signed executeBatch userOp", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("5.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );
    const executeBatchData = SmartAccount.interface.encodeFunctionData(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ]
    );

    const userOp = await fillAndSign(
      {
        sender: userSA.address,
        callData: executeBatchData,
        preVerificationGas: 75000,
      },
      sessionKey,
      entryPoint,
      "nonce"
    );

    // create a signature with the sessionKeyManager address
    const userOpHash = await entryPoint.getUserOpHash(userOp);
    const userOpHashAndModuleAddress = ethers.utils.hexConcat([
      ethers.utils.hexZeroPad(userOpHash, 32),
      ethers.utils.hexZeroPad(sessionKeyManager.address, 20),
    ]);
    const resultingHash = ethers.utils.keccak256(userOpHashAndModuleAddress);
    const signatureOverUserOpHashAndModuleAddress =
      await sessionKey.signMessage(ethers.utils.arrayify(resultingHash));

    const paddedSig = ethers.utils.defaultAbiCoder.encode(
      [
        "address",
        "tuple(uint48,uint48,address,bytes,bytes32[],bytes)[]",
        "bytes",
      ],
      [
        sessionKeyManager.address,
        [
          [
            0,
            0,
            erc20SessionModule.address,
            sessionKeyData,
            merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
            "0x",
          ],
          [
            0,
            0,
            mockProtocolSVM.address,
            sessionKeyData2,
            merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
            "0x",
          ],
        ],
        signatureOverUserOpHashAndModuleAddress,
      ]
    );

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [paddedSig, sessionRouter.address]
    );
    userOp.signature = signatureWithModuleAddress;

    await environment.sendUserOperation(userOp, entryPoint.address);

    expect(await mockToken.balanceOf(mockProtocol.address)).to.equal(
      tokenAmountToTransfer
    );
  });
});
