import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import {Contract} from "ethers";
import { encodeTransfer } from "../../utils/testUtils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import { fillAndSign, makeEcdsaModuleUserOp, makeEcdsaModuleUserOpWithPaymaster } from "../../utils/userOp";

describe("Upgrade v2 (Ownerless) to v3", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();
  let baseImplV3: Contract;

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();

    const entryPoint = await getEntryPoint();

    const mockToken = await getMockToken();

    const BaseImplementationV3 = await ethers.getContractFactory("SmartAccountV3");
    baseImplV3 = await BaseImplementationV3.deploy(entryPoint.address);
    await baseImplV3.deployed();

    const smartAccountFactory = await getSmartAccountFactory();

    const WalletFactoryV3 = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    const walletFactoryV3 = await WalletFactoryV3.deploy(baseImplV3.address);
    await walletFactoryV3.deployed();

    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory("EcdsaOwnershipRegistryModule");
      
    let ecdsaOwnershipSetupData = EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );

    const smartAccountDeploymentIndex = 0;

    const expectedSmartAccountAddressV3 =
            await walletFactoryV3.getAddressForCounterFactualAccount(ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex);
        
    await walletFactoryV3.deployCounterFactualAccount(ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex);

    const userSAV3 = await ethers.getContractAt(
            "contracts/smart-account/test/upgrades/v3/SmartAccountV3.sol:SmartAccountV3",
            expectedSmartAccountAddressV3
    );
    
    const userSA = await getSmartAccountWithModule(ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex);

    await deployer.sendTransaction({
      to: userSAV3.address,
      value: ethers.utils.parseEther("10"),
    });
    
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(userSAV3.address, ethers.utils.parseEther("1000000"));
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));
    
    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: smartAccountFactory,
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      userSAV3: userSAV3,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  it ("Newly deployed V3 SA and PoC Spending limits module work as intended", async () => {
    const { 
      ecdsaModule,
      userSAV3,
      entryPoint,
      mockToken
    } = await setupTests();

    const MockHookModule = await ethers.getContractFactory("MockHookModule");
    const mockHookModule1 = await MockHookModule.deploy();
    const mockHookModule2 = await MockHookModule.deploy();

    const SpendingLimitsModule = await ethers.getContractFactory("SpendingLimitsModule");
    const spendingLimitsModule = await SpendingLimitsModule.deploy(mockToken.address);

    const SpenderModule = await ethers.getContractFactory("SpenderModule");
    const spenderModule = await SpenderModule.deploy();

    const userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [
        mockHookModule1.address
      ],
      userSAV3.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    )
    await entryPoint.handleOps([userOp], alice.address);

    const userOp2 = await makeEcdsaModuleUserOp(
      "enableModule",
      [
        mockHookModule2.address
      ],
      userSAV3.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    )
    await entryPoint.handleOps([userOp2], alice.address);

    const userOp3 = await makeEcdsaModuleUserOp(
      "enableModule",
      [
        spendingLimitsModule.address
      ],
      userSAV3.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    )
    await entryPoint.handleOps([userOp3], alice.address);

    const userOp4 = await makeEcdsaModuleUserOp(
      "enableModule",
      [
        spenderModule.address
      ],
      userSAV3.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    )
    await entryPoint.handleOps([userOp4], alice.address);

    let limitSetData = spendingLimitsModule.interface.encodeFunctionData(
      "setLimits",
      [spenderModule.address, ethers.utils.parseEther("10"), 24*60*60]
    );
    const userOp5 = await makeEcdsaModuleUserOp(
      "executeCall_s1m",
      [
        spendingLimitsModule.address,
        ethers.utils.parseEther("0"),
        limitSetData
      ],
      userSAV3.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    )
    await entryPoint.handleOps([userOp5], alice.address);
    expect(await spendingLimitsModule.getLimits(userSAV3.address, spenderModule.address)).to.equal(ethers.utils.parseEther("10"));

    const spendingTxn = await spenderModule.spend(mockToken.address, charlie.address, ethers.utils.parseEther("10"), userSAV3.address);
    await spendingTxn.wait();

    const leftToSpend = (await spendingLimitsModule.getLimits(userSAV3.address, spenderModule.address)).sub(await spendingLimitsModule.calculateSpendingsForPeriod(userSAV3.address, spenderModule.address));
    expect (leftToSpend).to.equal(ethers.utils.parseEther("0"));

    await expect(
      spenderModule.spend(mockToken.address, charlie.address, ethers.utils.parseEther("10"), userSAV3.address)
    ).to.be.revertedWith("Spending limit exceeded");
  });

  it ("Can upgrade V2 to V3 and it is upgraded (calls hooks at userOp)", async () => {
    const { 
      ecdsaModule,
      userSA,
      entryPoint,
      mockToken
    } = await setupTests();

    const charlieBalanceBefore = await mockToken.balanceOf(charlie.address);
    const amountToTransfer = ethers.utils.parseEther("1");
    const MockHookModule = await ethers.getContractFactory("MockHookModule");
    const mockHookModule = await MockHookModule.deploy();
    const mockHookModuleCounterBefore = await mockHookModule.counter();
    
    const userOp = await makeEcdsaModuleUserOp(
      "updateImplementation",
      [
        await baseImplV3.address
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    await entryPoint.handleOps([userOp], alice.address);

    const userOp2 = await makeEcdsaModuleUserOp(
      "enableModule",
      [
        mockHookModule.address
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    )
    await entryPoint.handleOps([userOp2], alice.address);

    expect(await userSA.getImplementation()).to.equal(baseImplV3.address);
    expect(await userSA.isModuleEnabled(mockHookModule.address)).to.equal(true);

    const moduleTx = await mockHookModule.transfer(userSA.address, mockToken.address, charlie.address, amountToTransfer);
    await moduleTx.wait();
      
    expect(await mockHookModule.counter()).to.equal(mockHookModuleCounterBefore.add(2));
    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieBalanceBefore.add(amountToTransfer));
  });

  it ("Can upgrade the not deployed V2 to V3 and it is upgraded", async () => {
    const { entryPoint, smartAccountFactory, ecdsaModule, mockToken } = await setupTests();

    const charlieBalanceBefore = await mockToken.balanceOf(charlie.address);
    const amountToTransfer = ethers.utils.parseEther("0.5345");

    const MockHookModule = await ethers.getContractFactory("MockHookModule");
    const mockHookModule = await MockHookModule.deploy();
    const mockHookModuleCounterBefore = await mockHookModule.counter();

    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
      "EcdsaOwnershipRegistryModule"
    );
    const SmartAccountFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const ecdsaOwnershipSetupData =
      EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await alice.getAddress()]
      );
    const smartAccountDeploymentIndex = 0;
    const deploymentData = SmartAccountFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex]
    );

    const expectedSmartAccountAddress =
      await smartAccountFactory.getAddressForCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(expectedSmartAccountAddress, ethers.utils.parseEther("1000"));

    const updateImplData = SmartAccount.interface.encodeFunctionData(
      "updateImplementation",
      [baseImplV3.address]
    );

    const userOp = await fillAndSign(
      {
        sender: expectedSmartAccountAddress,
        callGasLimit: 1_000_000,
        initCode: ethers.utils.hexConcat([
          smartAccountFactory.address,
          deploymentData,
        ]),
        callData: updateImplData,
      },
      alice,
      entryPoint,
      "nonce"
    );

    // add validator module address to the signature
    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [userOp.signature, ecdsaModule.address]
    );
    userOp.signature = signatureWithModuleAddress;
    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address, {
      gasLimit: 10000000,
    });
    await handleOpsTxn.wait();
    const aliceSA = await ethers.getContractAt(
      "SmartAccount",
      expectedSmartAccountAddress
    );

    const userOp2 = await makeEcdsaModuleUserOp(
      "enableModule",
      [
        mockHookModule.address
      ],
      aliceSA.address,
      alice,
      entryPoint,
      ecdsaModule.address
    )
    await entryPoint.handleOps([userOp2], alice.address);

    expect(await aliceSA.getImplementation()).to.equal(baseImplV3.address);
    expect(await aliceSA.isModuleEnabled(mockHookModule.address)).to.equal(true);

    const moduleTx = await mockHookModule.transfer(aliceSA.address, mockToken.address, charlie.address, amountToTransfer);
    await moduleTx.wait();
      
    expect(await mockHookModule.counter()).to.equal(mockHookModuleCounterBefore.add(2));
    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieBalanceBefore.add(amountToTransfer));
  });

  it ("Can upgrade the not deployed V2 to V3 via batched calldata in the userOp: upgrade + send ether", async () => {
    const { entryPoint, smartAccountFactory, ecdsaModule } = await setupTests();

    const charlieNativeBalanceBefore = await charlie.getBalance();
    const amountToTransfer = ethers.utils.parseEther("0.572455");

    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
      "EcdsaOwnershipRegistryModule"
    );
    const SmartAccountFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const ecdsaOwnershipSetupData =
      EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await alice.getAddress()]
      );
    const smartAccountDeploymentIndex = 0;
    const deploymentData = SmartAccountFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex]
    );

    const expectedSmartAccountAddress =
      await smartAccountFactory.getAddressForCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("10"),
    });

    const updateImplData = SmartAccount.interface.encodeFunctionData(
      "updateImplementation",
      [baseImplV3.address]
    );
    const execBatchCallData = SmartAccount.interface.encodeFunctionData(
      "executeBatchCall_4by",
      [[expectedSmartAccountAddress, charlie.address],[ethers.utils.parseEther("0"), amountToTransfer],[updateImplData, "0x"]]
    );

    const userOp = await fillAndSign(
      {
        sender: expectedSmartAccountAddress,
        callGasLimit: 1_000_000,
        initCode: ethers.utils.hexConcat([
          smartAccountFactory.address,
          deploymentData,
        ]),
        callData: execBatchCallData,
      },
      alice,
      entryPoint,
      "nonce"
    );
    // add validator module address to the signature
    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [userOp.signature, ecdsaModule.address]
    );
    userOp.signature = signatureWithModuleAddress;
    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address, {
      gasLimit: 10000000,
    });
    await handleOpsTxn.wait();
    const aliceSA = await ethers.getContractAt(
      "SmartAccount",
      expectedSmartAccountAddress
    );
    expect(await aliceSA.getImplementation()).to.equal(baseImplV3.address);
    expect(await charlie.getBalance()).to.equal(charlieNativeBalanceBefore.add(amountToTransfer));
  });

  it ("Can upgrade the not deployed V2 to V3 via batched calldata in the userOp: upgrade + update callback handler + send erc20 token", async () => {
    const { entryPoint, smartAccountFactory, ecdsaModule, mockToken } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const amountToTransfer = ethers.utils.parseEther("0.32981");

    const FallbackHandler = await ethers.getContractFactory("DefaultCallbackHandler");
    const newFallbackHandler = await FallbackHandler.deploy();
    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
      "EcdsaOwnershipRegistryModule"
    );
    const SmartAccountFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const ecdsaOwnershipSetupData =
      EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await alice.getAddress()]
      );
    const smartAccountDeploymentIndex = 0;
    const deploymentData = SmartAccountFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex]
    );

    const expectedSmartAccountAddress =
      await smartAccountFactory.getAddressForCounterFactualAccount(
        ecdsaModule.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(expectedSmartAccountAddress, ethers.utils.parseEther("1000"));

    const updateImplData = SmartAccount.interface.encodeFunctionData(
      "updateImplementation",
      [baseImplV3.address]
    );
    const setHandlerData = SmartAccount.interface.encodeFunctionData(
      "setFallbackHandler",
      [newFallbackHandler.address]
    );
    const transferTokenData = encodeTransfer(charlie.address, amountToTransfer.toString());

    const execBatchCallData = SmartAccount.interface.encodeFunctionData(
      "executeBatchCall_4by",
      [[expectedSmartAccountAddress, expectedSmartAccountAddress,  mockToken.address ],
       [0,0,0],
       [updateImplData, setHandlerData,  transferTokenData ]
      ]
    );

    const userOp = await fillAndSign(
      {
        sender: expectedSmartAccountAddress,
        callGasLimit: 1_000_000,
        initCode: ethers.utils.hexConcat([
          smartAccountFactory.address,
          deploymentData,
        ]),
        callData: execBatchCallData,
      },
      alice,
      entryPoint,
      "nonce"
    );
    // add validator module address to the signature
    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [userOp.signature, ecdsaModule.address]
    );
    userOp.signature = signatureWithModuleAddress;
    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address, {
      gasLimit: 10000000,
    });
    await handleOpsTxn.wait();
    const aliceSA = await ethers.getContractAt(
      "SmartAccount",
      expectedSmartAccountAddress
    );
    expect(await aliceSA.getImplementation()).to.equal(baseImplV3.address);
    expect(await aliceSA.getFallbackHandler()).to.equal(newFallbackHandler.address);
    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(amountToTransfer));
  });
});
