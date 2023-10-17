import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
  makeEcdsaModuleUserOp,
  getUserOpHash,
  fillAndSign,
} from "../../utils/userOp";
import {
  getEntryPoint,
  getMockToken,
  getStakedSmartAccountFactory,
} from "../../utils/setupHelper";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("MultiOwned ECDSA Module (with Bundler):", async () => {
  let [
    deployer,
    smartAccountOwner1,
    smartAccountOwner2,
    smartAccountOwner3,
    eve,
  ] = [] as SignerWithAddress[];
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
    [
      deployer,
      smartAccountOwner1,
      smartAccountOwner2,
      smartAccountOwner3,
      eve,
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

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const saFactory = await getStakedSmartAccountFactory();
    const multiOwnedECDSAModule = await (
      await ethers.getContractFactory("MultiOwnedECDSAModule")
    ).deploy();
    const mockToken = await getMockToken();

    const ecdsaOwnershipSetupData =
      multiOwnedECDSAModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [
          [
            smartAccountOwner1.address,
            smartAccountOwner2.address,
            smartAccountOwner3.address,
          ],
        ]
      );

    const deploymentData = saFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [
        multiOwnedECDSAModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex,
      ]
    );

    const expectedSmartAccountAddress =
      await saFactory.getAddressForCounterFactualAccount(
        multiOwnedECDSAModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

    const tokensToMint = ethers.utils.parseEther("100");
    await mockToken.mint(expectedSmartAccountAddress, tokensToMint.toString());
    await mockToken.mint(eve.address, tokensToMint.toString());

    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("60"),
    });

    await deployer.sendTransaction({
      to: smartAccountOwner1.address,
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
      smartAccountOwner1,
      entryPoint,
      "nonce"
    );

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [deploymentUserOp.signature, multiOwnedECDSAModule.address]
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
      multiOwnedECDSAModule: multiOwnedECDSAModule,
      ecdsaOwnershipSetupData: ecdsaOwnershipSetupData,
      userSA: userSA,
      mockToken: mockToken,
    };
  });

  describe("transferOwnership: ", async () => {
    it("Call transferOwnership from userSA and it successfully changes owner ", async () => {
      const { multiOwnedECDSAModule, entryPoint, userSA } = await setupTests();
      // console.log(await userSA.getImplementation());

      // Calldata to set Eve as owner
      const txnData1 = multiOwnedECDSAModule.interface.encodeFunctionData(
        "transferOwnership",
        [smartAccountOwner2.address, eve.address]
      );
      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [multiOwnedECDSAModule.address, 0, txnData1],
        userSA.address,
        smartAccountOwner1, // can be signed by any owner
        entryPoint,
        multiOwnedECDSAModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);
      expect(
        await multiOwnedECDSAModule.isOwner(userSA.address, eve.address)
      ).to.equal(true);
    });
  });

  describe("removeOwner():", async () => {
    it("Should be able to renounce ownership and the new owner should be address(0)", async () => {
      const { multiOwnedECDSAModule, entryPoint, userSA } = await setupTests();
      const txnData1 = multiOwnedECDSAModule.interface.encodeFunctionData(
        "removeOwner",
        [smartAccountOwner2.address]
      );
      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [multiOwnedECDSAModule.address, 0, txnData1],
        userSA.address,
        smartAccountOwner3, // any owner can sign
        entryPoint,
        multiOwnedECDSAModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);
      expect(
        await multiOwnedECDSAModule.isOwner(
          userSA.address,
          smartAccountOwner2.address
        )
      ).to.equal(false);
    });
  });

  describe("validateUserOp(): ", async () => {
    it("Returns SIG_VALIDATION_SUCCESS for a valid UserOp and valid userOpHash and allows to handle userOp", async () => {
      const { multiOwnedECDSAModule, entryPoint, userSA, mockToken } =
        await setupTests();
      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const eveBalanceBefore = await mockToken.balanceOf(eve.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("3.5672");

      const txnData = mockToken.interface.encodeFunctionData("transfer", [
        eve.address,
        tokenAmountToTransfer.toString(),
      ]);
      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        smartAccountOwner2, // any owner can sign
        entryPoint,
        multiOwnedECDSAModule.address,
        {
          preVerificationGas: 50000,
        }
      );
      // Construct userOpHash
      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const userOpHash = getUserOpHash(userOp, entryPoint.address, chainId);

      const res = await multiOwnedECDSAModule.validateUserOp(
        userOp,
        userOpHash
      );
      expect(res).to.be.equal(SIG_VALIDATION_SUCCESS);
      await environment.sendUserOperation(userOp, entryPoint.address);
      expect(await mockToken.balanceOf(eve.address)).to.equal(
        eveBalanceBefore.add(tokenAmountToTransfer)
      );
      expect(await mockToken.balanceOf(userSA.address)).to.equal(
        userSABalanceBefore.sub(tokenAmountToTransfer)
      );
      expect(await multiOwnedECDSAModule.getNumberOfOwners(userSA.address)).to.equal(3);
    });
  });
});
