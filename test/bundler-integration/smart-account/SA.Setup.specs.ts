import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
  deployContract,
} from "../../utils/setupHelper";
import { makeEcdsaModuleUserOp } from "../../utils/userOp";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Smart Account Setup (with Bundler)", async () => {
  let deployer: SignerWithAddress,
    smartAccountOwner: SignerWithAddress,
    verifiedSigner: SignerWithAddress;

  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async () => {
    [deployer, smartAccountOwner, verifiedSigner] = await ethers.getSigners();
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
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  describe("Update Implementation", async () => {
    // updates the implementation and calls are forwarded to the new implementation and the event
    it("can update to an implementation and calls are forwarded and event is emitted", async () => {
      const { entryPoint, ecdsaModule, userSA } = await setupTests();

      const NEW_IMPL_SOURCE = `
        contract Impl2 {
          function selfIdentify() public returns (string memory) {
              return "implementation 2";
          }
          function getImplementation()
            external
            view
            returns (address _implementation)
          {
              assembly {
                  _implementation := sload(address())
              }
          }
        }`;
      const impl2 = await deployContract(deployer, NEW_IMPL_SOURCE, {
        evmVersion: "london", // Prevent usage of PUSH0
      });
      const userOp = await makeEcdsaModuleUserOp(
        "updateImplementation",
        [impl2.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);

      const abi = ["function selfIdentify() view returns(string memory)"];
      const userSAImpl2 = new ethers.Contract(userSA.address, abi, deployer);

      expect(await userSA.getImplementation()).to.equal(impl2.address);
      expect(await userSAImpl2.selfIdentify()).to.equal("implementation 2");
    });
  });

  // update callback handler
  describe("Update Implementation", async () => {
    // updates the callback handler and calls are forwarded to the new callback handler and the event is emitted
    it("can update to a callback handler and calls are forwarded and event is emitted", async () => {
      const { entryPoint, ecdsaModule, userSA } = await setupTests();

      const NEW_HANDLER_SOURCE = `
        contract Handler2 {
          function selfIdentify() public returns (string memory) {
              return "handler 2";
          }
        }`;
      const handler2 = await deployContract(deployer, NEW_HANDLER_SOURCE, {
        evmVersion: "london", // Prevent usage of PUSH0
      });

      const userOp = await makeEcdsaModuleUserOp(
        "setFallbackHandler",
        [handler2.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);

      const abi = ["function selfIdentify() view returns(string memory)"];
      const userSAWithHandler2 = new ethers.Contract(
        userSA.address,
        abi,
        deployer
      );

      expect(await userSA.getFallbackHandler()).to.equal(handler2.address);
      expect(await userSAWithHandler2.selfIdentify()).to.equal("handler 2");
    });
  });
});
