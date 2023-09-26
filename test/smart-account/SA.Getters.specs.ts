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

describe("Smart Account Getters", async () => {
  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] =
    waffle.provider.getWallets();

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

  it("getDeposit returns correct EntryPoint deposit", async () => {
    const { userSA } = await setupTests();
    const amountToDeposit = ethers.utils.parseEther("1");
    userSA.addDeposit({ value: amountToDeposit });
    expect(await userSA.getDeposit()).to.equal(amountToDeposit);
  });

  it("supports ERC165 Interface", async () => {
    const { userSA } = await setupTests();
    const ERC165InterfaceId = "0x01ffc9a7";
    expect(await userSA.supportsInterface(ERC165InterfaceId)).to.equal(true);
  });

  it("nonce returns correct nonce", async () => {
    const { userSA, entryPoint } = await setupTests();
    expect(await userSA.nonce(0)).to.equal(
      await entryPoint.getNonce(userSA.address, 0)
    );
  });
});
