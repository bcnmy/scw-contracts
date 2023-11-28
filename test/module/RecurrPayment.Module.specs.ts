import { expect } from "chai";
import {
  enableNewTreeForSmartAccountViaEcdsa,
  getERC20SessionKeyParams,
  makeEcdsaSessionKeySignedBatchUserOp,
} from "../utils/sessionKey";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../utils/userOp";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../utils/setupHelper";
import { computeAddress, defaultAbiCoder } from "ethers/lib/utils";

describe("Recurr Payment", async () => {
  const [deployer, smartAccountOwner, alice, sessionKey, nonAuthSessionKey] =
    waffle.provider.getWallets();
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

      const subPrice = ethers.utils.parseEther("0.1");

      const mockSubscription = await (
        await ethers.getContractFactory("MockSubscriptionProvider")
      ).deploy(subPrice);

      const recurrPayModule = await (
        await ethers.getContractFactory("RecurringPaymentsModule")
      ).deploy();

      const timeNow = (await ethers.provider.getBlock("latest")).timestamp;
      const subPeriod = 60 * 60 * 24 * 30;
      const recurrPaymentData =
        mockSubscription.interface.encodeFunctionData("extendSubscription");

      const recurrSetupData = recurrPayModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [
          [
            mockSubscription.address,
            timeNow - subPeriod - 3600,
            subPeriod,
            subPrice,
            recurrPaymentData,
          ],
        ]
      );

      const subHash = await recurrPayModule.getSubHash({
        receiver: mockSubscription.address,
        nextPaymentDue: timeNow - subPeriod - 3600,
        subscriptionPeriod: subPeriod,
        paymentAmount: subPrice,
        callData: recurrPaymentData,
      });

      const userOp2 = await makeEcdsaModuleUserOp(
        "setupAndEnableModule",
        [recurrPayModule.address, recurrSetupData],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      await entryPoint.handleOps([userOp2], alice.address);

      return {
        entryPoint: entryPoint,
        smartAccountImplementation: await getSmartAccountImplementation(),
        smartAccountFactory: await getSmartAccountFactory(),
        ecdsaModule: ecdsaModule,
        userSA: userSA,
        mockToken: mockToken,
        mockSubscription: mockSubscription,
        recurrPayModule: recurrPayModule,
        subHash: subHash,
      };
    }
  );

  it("Should pay for the sub", async () => {
    const { entryPoint, userSA, mockSubscription, recurrPayModule, subHash } =
      await setupTests();

    // time to pay!
    const txnData1 = recurrPayModule.interface.encodeFunctionData(
      "executeRecurringPayment",
      [subHash, userSA.address]
    );

    const userOp = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [recurrPayModule.address, 0, txnData1],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      recurrPayModule.address
    );

    await entryPoint.handleOps([userOp], alice.address, { gasLimit: 1000000 });

    const currentTime = (await ethers.provider.getBlock("latest")).timestamp;

    expect(await mockSubscription.paymentTimes(userSA.address)).to.be.gte(
      currentTime
    );
  });
});
