import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";

describe("Modular Smart Account Basics: ", async () => {
  const [deployer, smartAccountOwner, verifiedSigner] =
    waffle.provider.getWallets();

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

  it("Can deploy SA with default module", async () => {
    const { mockToken, ecdsaModule, userSA } = await setupTests();

    expect(await userSA.isModuleEnabled(ecdsaModule.address)).to.equal(true);
    expect(await ecdsaModule.getOwner(userSA.address)).to.equal(
      smartAccountOwner.address
    );

    expect(await ethers.provider.getBalance(userSA.address)).to.equal(
      ethers.utils.parseEther("10")
    );
    expect(await mockToken.balanceOf(userSA.address)).to.equal(
      ethers.utils.parseEther("1000000")
    );
  });

  /**
   * To test that SA and Modules work properly in the wild, the most important tests
   * such as "Send userOp" and "Send userOp with Paymaster" need to be tested in a
   * bundler-enabled environment. Thus such test has been moved into the /bundler-integration
   * suite.
   *
   * See test/bundler-integration/smart-account/SA.Basics.specs.ts for more Basic SA tests
   */

  it("Can verify a signature through isValidSignature", async () => {
    const { userSA, ecdsaModule } = await setupTests();

    const eip1271MagicValue = "0x1626ba7e";
    const message = "Some message from dApp";
    const messageHash = ethers.utils.hashMessage(message);

    const signature = await smartAccountOwner.signMessage(message);
    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [signature, ecdsaModule.address]
    );

    const returnedValue = await userSA.isValidSignature(
      messageHash,
      signatureWithModuleAddress
    );
    expect(returnedValue).to.be.equal(eip1271MagicValue);
  });
});
