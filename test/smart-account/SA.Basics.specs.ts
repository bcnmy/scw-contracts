import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
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

    const stringMessage = "SCW signed this message";
    const messageHash = ethers.utils.solidityKeccak256(
      ["string"],
      [stringMessage]
    );
    const messageHashAndAddress = ethers.utils.arrayify(
      ethers.utils.hexConcat([messageHash, userSA.address])
    );
    const signature = await smartAccountOwner.signMessage(
      messageHashAndAddress
    );

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

  it("Can not receive native token with 2300 gas with cold slots", async () => {
    const { userSA, ecdsaModule, entryPoint } = await setupTests();

    const amountToSend = ethers.utils.parseEther("0.1");

    // deploy MockEthSender
    const mockEthSender = await (
      await ethers.getContractFactory("MockEthSender")
    ).deploy();

    // send funds to it
    await deployer.sendTransaction({
      to: mockEthSender.address,
      value: ethers.utils.parseEther("10"),
    });

    const provider = entryPoint?.provider;
    const userSABalanceBefore = await provider.getBalance(userSA.address);

    const gasStipend = 0;
    await expect(
      mockEthSender.send(userSA.address, amountToSend, gasStipend)
    ).to.be.revertedWith("Can not send eth");
    expect(await provider.getBalance(userSA.address)).to.equal(
      userSABalanceBefore
    );
  });

  it("Can receive native token with 2300 gas with pre-warmed slots", async () => {
    const { userSA, ecdsaModule, entryPoint } = await setupTests();

    const amountToSend = ethers.utils.parseEther("0.1");

    // deploy MockEthSender
    const mockEthSender = await (
      await ethers.getContractFactory("MockEthSender")
    ).deploy();

    // send funds to it
    await deployer.sendTransaction({
      to: mockEthSender.address,
      value: ethers.utils.parseEther("10"),
    });

    const provider = entryPoint?.provider;
    const userSABalanceBefore = await provider.getBalance(userSA.address);

    const gasStipend = 0;
    await mockEthSender.sendPreWarm(userSA.address, amountToSend, gasStipend);
    expect(await provider.getBalance(userSA.address)).to.equal(
      userSABalanceBefore.add(amountToSend)
    );
  });
});
