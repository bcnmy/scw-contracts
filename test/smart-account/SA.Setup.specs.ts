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
  deployContract
} from "../utils/setupHelper";
import { makeEcdsaModuleUserOp } from "../utils/userOp";
import { AddressZero } from "@ethersproject/constants";

describe("Smart Account Setup", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();

    const mockToken = await getMockToken();
    
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory("EcdsaOwnershipRegistryModule");
      
    let ecdsaOwnershipSetupData = EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );

    const smartAccountDeploymentIndex = 0;

    const userSA = await getSmartAccountWithModule(ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex);

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

  describe("Initialization", async () => {

    it ("Sets the default callback handler", async () => {
      const { 
        smartAccountFactory,
        userSA
      } = await setupTests();

      expect(await userSA.getFallbackHandler()).to.equal(await smartAccountFactory.minimalHandler());
    });

    it ("Setups the default authorization module", async () => {
      const { 
        ecdsaModule,
        userSA
      } = await setupTests();

      expect(await userSA.isModuleEnabled(ecdsaModule.address)).to.equal(true);
      expect(await ecdsaModule.getOwner(userSA.address)).to.equal(smartAccountOwner.address);
    });

    it ("Reverts if called with invalid initial module", async () => {
      const { 
        smartAccountFactory,
      } = await setupTests();

      // deploy a module that doesn't return address at setup
      const MockInvalidInitialAuthModule = await ethers.getContractFactory("MockInvalidInitialAuthModule");
      const mockInvalidInitialAuthModule = await MockInvalidInitialAuthModule.deploy();

      const invalidModuleSetupData = mockInvalidInitialAuthModule.interface.encodeFunctionData("init", ["0xabcdef"]);

      await expect(
        smartAccountFactory.deployCounterFactualAccount(
          mockInvalidInitialAuthModule.address,
          invalidModuleSetupData,
          0
        )
      ).to.be.revertedWith("ModuleCannotBeZeroOrSentinel");
    });

    it ("Can not be called after proxy deployment", async () => {
      const { 
        ecdsaModule,
        userSA
      } = await setupTests();
      
      await expect(
        userSA.init(
          AddressZero,
          ecdsaModule.address,
          "0x"
        )
      ).to.be.revertedWith("AlreadyInitialized");
    });

    it ("Can not be called on implementation", async () => {
      const { 
        smartAccountImplementation,
        ecdsaModule
      } = await setupTests();

      await expect(
        smartAccountImplementation.init(
          AddressZero,
          ecdsaModule.address,
          "0x"
        )
      ).to.be.revertedWith("AlreadyInitialized");
    });
  });

  describe("Update Implementation", async () => {

    it ("Can not be called not from EntryPoint or Self", async () => {
      const { 
        smartAccountImplementation,
        userSA,
      } = await setupTests();

      await expect(
        userSA.updateImplementation(AddressZero)
      ).to.be.revertedWith("CallerIsNotEntryPointOrSelf").withArgs(deployer.address);
      expect(await userSA.getImplementation()).to.equal(smartAccountImplementation.address);
    });
    
    it ("can not set address(0) as implementation", async () => {
      const { 
        entryPoint,
        ecdsaModule,
        userSA,
      } = await setupTests();

      const userOp = await makeEcdsaModuleUserOp(
        "updateImplementation",
        [
          AddressZero
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      )
      const implementationInSaBefore = await userSA.getImplementation();
      const handleOpsTx = await entryPoint.handleOps([userOp], alice.address);
      expect(handleOpsTx).to.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.getImplementation()).to.equal(implementationInSaBefore);
    });

    //can not set eoa as implementation
    it ("can not set EOA as implementation", async () => {
      const { 
        entryPoint,
        ecdsaModule,
        userSA,
      } = await setupTests();

      const userOp = await makeEcdsaModuleUserOp(
        "updateImplementation",
        [
          bob.address
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      )
      const implementationInSaBefore = await userSA.getImplementation();
      const handleOpsTx = await entryPoint.handleOps([userOp], alice.address);
      expect(handleOpsTx).to.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.getImplementation()).to.equal(implementationInSaBefore);
    });

    //updates the implementation and calls are forwarded to the new implementation and the event 
    it ("can update to an implementation and calls are forwarded and event is emitted", async () => {
      const { 
        entryPoint,
        ecdsaModule,
        userSA,
      } = await setupTests();

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
      const impl2 = await deployContract(deployer, NEW_IMPL_SOURCE);
      
      const implementationInSaBefore = await userSA.getImplementation();

      const userOp = await makeEcdsaModuleUserOp(
        "updateImplementation",
        [
          impl2.address
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      )
  
      const handleOpsTx = await entryPoint.handleOps([userOp], alice.address);
      expect(handleOpsTx).to.emit(userSA, "ImplementationUpdated").withArgs(implementationInSaBefore, impl2.address);

      const abi = [
        'function selfIdentify() view returns(string memory)'
      ];
      const userSAImpl2 = new ethers.Contract(userSA.address, abi, deployer);
      
      expect(await userSA.getImplementation()).to.equal(impl2.address);
      expect(await userSAImpl2.selfIdentify()).to.equal("implementation 2");
    });
      
  });

  //update callback handler
  describe("Update Implementation", async () => {
    it ("Can not be called not from EntryPoint or Self", async () => {
      const { 
        userSA,
      } = await setupTests();
      const prevHandler = await userSA.getFallbackHandler();

      await expect(
        userSA.setFallbackHandler(AddressZero)
      ).to.be.revertedWith("CallerIsNotEntryPointOrSelf").withArgs(deployer.address);
      expect(await userSA.getFallbackHandler()).to.equal(prevHandler);
    });

    it ("Can not be called on implementation", async () => {
      //as the implementation has no validation modules enabled,
      //so it can not validateUserOp => setFallbackHandler userOp will always revert
      //and there are no other ways of calling setFallbackHandler because of the _requireFromEntryPoint()
      const { 
        smartAccountImplementation,
        entryPoint,
        ecdsaModule,
      } = await setupTests();

      await entryPoint.depositTo(smartAccountImplementation.address, {value: ethers.utils.parseEther("1")});

      const prevHandler = await smartAccountImplementation.getFallbackHandler();
      await expect(prevHandler).to.equal(AddressZero);
      const userOp = await makeEcdsaModuleUserOp(
        "setFallbackHandler",
        [
          "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
        ],
        smartAccountImplementation.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      await expect(entryPoint.handleOps([userOp], alice.address)).to.be.revertedWith("FailedOp");
      expect(await smartAccountImplementation.getFallbackHandler()).to.equal(prevHandler);
    });

    it("Can not set address(0) as callback handler", async () => {
      const { 
        entryPoint,
        ecdsaModule,
        userSA,
      } = await setupTests();

      const userOp = await makeEcdsaModuleUserOp(
        "setFallbackHandler",
        [
          AddressZero
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      )
      const handlerInSaBefore = await userSA.getFallbackHandler();
      const handleOpsTx = await entryPoint.handleOps([userOp], alice.address);
      expect(handleOpsTx).to.emit(entryPoint, "UserOperationRevertReason");
      expect(await userSA.getFallbackHandler()).to.equal(handlerInSaBefore);
    });

    // updates the callback handler and calls are forwarded to the new callback handler and the event is emitted
    it("can update to a callback handler and calls are forwarded and event is emitted", async () => {
      const { 
        entryPoint,
        ecdsaModule,
        userSA,
      } = await setupTests();

      const NEW_HANDLER_SOURCE = `
        contract Handler2 {
          function selfIdentify() public returns (string memory) {
              return "handler 2";
          }
        }`;
      const handler2 = await deployContract(deployer, NEW_HANDLER_SOURCE);
      
      const handlerInSaBefore = await userSA.getFallbackHandler();

      const userOp = await makeEcdsaModuleUserOp(
        "setFallbackHandler",
        [
          handler2.address
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      )
  
      const handleOpsTx = await entryPoint.handleOps([userOp], alice.address);
      expect(handleOpsTx).to.emit(userSA, "ChangedFallbackHandler").withArgs(handlerInSaBefore, handler2.address);

      const abi = [
        'function selfIdentify() view returns(string memory)'
      ];
      const userSAWithHandler2 = new ethers.Contract(userSA.address, abi, deployer);
      
      expect(await userSA.getFallbackHandler()).to.equal(handler2.address);
      expect(await userSAWithHandler2.selfIdentify()).to.equal("handler 2");
    });

  });
  

});
