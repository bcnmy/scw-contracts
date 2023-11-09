import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getEcdsaOwnershipRegistryModule,
  getAddressResolver,
  getSmartAccountFactoryV1,
  getMultiChainModule,
} from "../utils/setupHelper";
import { BigNumber } from "ethers";

export type SmartAccountInfo = {
  accountAddress: string;
  factoryAddress: string;
  currentImplementation: string;
  currentVersion: string;
  factoryVersion: string;
  deploymentIndex: BigNumber;
};

describe("Address Resolver", function () {
  const [
    deployer,
    smartAccountOwner,
    smartAccountOwner2,
    alice,
    bob,
    charlie,
    eve,
    fox,
  ] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(
    async ({ deployments, getNamedAccounts }) => {
      await deployments.fixture();

      const addressResolver = await getAddressResolver();

      const entryPoint = await getEntryPoint();
      const { chainId } = await entryPoint.provider.getNetwork();

      const smartAccountFactoryV1 = await getSmartAccountFactoryV1();

      const ecdsaModule = await getEcdsaOwnershipRegistryModule();

      return {
        entryPoint: entryPoint,
        addressResolver: addressResolver,
        smartAccountImplementation: await getSmartAccountImplementation(),
        smartAccountImplementationV1: await getSmartAccountImplementation(),
        smartAccountFactory: await getSmartAccountFactory(),
        smartAccountFactoryV1: smartAccountFactoryV1,
        ecdsaModule: ecdsaModule,
        multiChainModule: await getMultiChainModule(),
        chainId: chainId,
      };
    }
  );

  describe("Address Resolver Functionality", async () => {
    it("Deploys accounts from factories and calls the getters", async () => {
      const {
        entryPoint,
        addressResolver,
        smartAccountImplementation,
        smartAccountImplementationV1,
        smartAccountFactory,
        smartAccountFactoryV1,
        multiChainModule,
        ecdsaModule,
        chainId,
      } = await setupTests();

      const saAddress1 =
        await smartAccountFactoryV1.getAddressForCounterFactualAccount(
          smartAccountOwner.address,
          0
        );

      const saAddress2 =
        await smartAccountFactoryV1.getAddressForCounterFactualAccount(
          smartAccountOwner.address,
          1
        );

      const saAddress3 =
        await smartAccountFactoryV1.getAddressForCounterFactualAccount(
          smartAccountOwner2.address,
          0
        );

      await smartAccountFactoryV1.deployCounterFactualAccount(
        smartAccountOwner.address,
        0
      );
      await smartAccountFactoryV1.deployCounterFactualAccount(
        smartAccountOwner.address,
        1
      );
      await smartAccountFactoryV1.deployCounterFactualAccount(
        smartAccountOwner2.address,
        0
      );

      const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
        "EcdsaOwnershipRegistryModule"
      );

      const ecdsaOwnershipSetupData1 =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [smartAccountOwner.address]
        );

      const saAddress4 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData1,
          0
        );

      await smartAccountFactory.deployCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData1,
        0
      );

      const saAddress5 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData1,
          1
        );

      await smartAccountFactory.deployCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData1,
        1
      );

      const ecdsaOwnershipSetupData2 =
        EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [smartAccountOwner2.address]
        );

      const saAddress6 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData2,
          1
        );

      await smartAccountFactory.deployCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData2,
        1
      );

      const saAddress7 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          ecdsaModule.address,
          ecdsaOwnershipSetupData1,
          2
        );

      await smartAccountFactory.deployCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData1,
        2
      );

      const MultiChainValidator = await ethers.getContractFactory(
        "MultichainECDSAValidator"
      );

      const multiChainSetupData1 =
        MultiChainValidator.interface.encodeFunctionData(
          "initForSmartAccount",
          [smartAccountOwner.address]
        );

      const saAddress8 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          multiChainModule.address,
          multiChainSetupData1,
          0
        );

      await smartAccountFactory.deployCounterFactualAccount(
        multiChainModule.address,
        multiChainSetupData1,
        0
      );

      const saAddress9 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          multiChainModule.address,
          multiChainSetupData1,
          1
        );

      await smartAccountFactory.deployCounterFactualAccount(
        multiChainModule.address,
        multiChainSetupData1,
        1
      );

      const multiChainSetupData2 =
        MultiChainValidator.interface.encodeFunctionData(
          "initForSmartAccount",
          [smartAccountOwner2.address]
        );

      const saAddress10 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          multiChainModule.address,
          multiChainSetupData2,
          0
        );

      await smartAccountFactory.deployCounterFactualAccount(
        multiChainModule.address,
        multiChainSetupData2,
        0
      );

      const saAddress11 =
        await smartAccountFactory.getAddressForCounterFactualAccount(
          multiChainModule.address,
          multiChainSetupData2,
          1
        );

      await smartAccountFactory.deployCounterFactualAccount(
        multiChainModule.address,
        multiChainSetupData2,
        1
      );

      const result1 = await addressResolver.resolveAddresses(
        smartAccountOwner.address,
        2
      );

      const result2 = await addressResolver.resolveAddressesFlexibleForV2(
        smartAccountOwner.address,
        2,
        multiChainModule.address,
        multiChainSetupData1
      );

      const result3 = await addressResolver.resolveAddressesV1(
        smartAccountOwner.address,
        2
      );

      const result4 = await addressResolver.resolveAddressesV1(
        smartAccountOwner2.address,
        2
      );

      const result5 = await addressResolver.resolveAddressesFlexibleForV2(
        smartAccountOwner2.address,
        2,
        ecdsaModule.address,
        ecdsaOwnershipSetupData2
      );

      // Check presence of all accounts

      const accountObject1 = result1.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v1" &&
          smartAccountInfo.currentVersion === "1.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 0
      );

      expect(accountObject1?.accountAddress).to.be.equal(saAddress1);

      const accountObject2 = result1.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v1" &&
          smartAccountInfo.currentVersion === "1.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 1
      );

      expect(accountObject2?.accountAddress).to.be.equal(saAddress2);

      const accountObject4 = result1.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v2" &&
          smartAccountInfo.currentVersion === "2.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 0
      );

      expect(accountObject4?.accountAddress).to.be.equal(saAddress4);

      const accountObject5 = result1.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v2" &&
          smartAccountInfo.currentVersion === "2.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 1
      );

      expect(accountObject5?.accountAddress).to.be.equal(saAddress5);

      const accountObject8 = result2.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v2" &&
          smartAccountInfo.currentVersion === "2.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 0
      );

      expect(accountObject8?.accountAddress).to.be.equal(saAddress8);

      const accountObject9 = result2.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v2" &&
          smartAccountInfo.currentVersion === "2.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 1
      );

      expect(accountObject9?.accountAddress).to.be.equal(saAddress9);

      const accountObject1Result2 = result2.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v1" &&
          smartAccountInfo.currentVersion === "1.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 0
      );

      expect(accountObject1Result2?.accountAddress).to.be.equal(saAddress1);

      const accountObject2Result2 = result2.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v1" &&
          smartAccountInfo.currentVersion === "1.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 1
      );

      expect(accountObject2Result2?.accountAddress).to.be.equal(saAddress2);

      const accountObject1Result3 = result3.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v1" &&
          smartAccountInfo.currentVersion === "1.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 0
      );

      expect(accountObject1Result3?.accountAddress).to.be.equal(saAddress1);

      const accountObject2Result3 = result3.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v1" &&
          smartAccountInfo.currentVersion === "1.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 1
      );

      expect(accountObject2Result3?.accountAddress).to.be.equal(saAddress2);

      const accountObject3Result4 = result4.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v1" &&
          smartAccountInfo.currentVersion === "1.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 0
      );

      expect(accountObject3Result4?.accountAddress).to.be.equal(saAddress3);

      const accountObject6Result5 = result5.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v2" &&
          smartAccountInfo.currentVersion === "2.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 1
      );

      expect(accountObject6Result5?.accountAddress).to.be.equal(saAddress6);

      const accountObject3Result5 = result5.find(
        (smartAccountInfo: SmartAccountInfo) =>
          smartAccountInfo.factoryVersion === "v1" &&
          smartAccountInfo.currentVersion === "1.0.0" &&
          smartAccountInfo.deploymentIndex.toNumber() === 0
      );

      expect(accountObject3Result5?.accountAddress).to.be.equal(saAddress3);
    });
  });
});
