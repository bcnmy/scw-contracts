import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { encodeTransfer } from "../../smart-wallet/testUtils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEOAOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import { fillAndSign, makeEOAModuleUserOp, makeEOAModuleUserOpWithPaymaster } from "../../utils/userOp";

describe("NEW::: Upgrade v1 to Ownerless", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();

    const entryPoint = await getEntryPoint();

    const mockToken = await getMockToken();

    const BaseImplementationV1 = await ethers.getContractFactory("SmartAccountV1");
    const baseImplV1 = await BaseImplementationV1.deploy(entryPoint.address);
    await baseImplV1.deployed();

    const WalletFactoryV1 = await ethers.getContractFactory(
      "SmartAccountFactoryV1"
    );
    const walletFactoryV1 = await WalletFactoryV1.deploy(baseImplV1.address);
    await walletFactoryV1.deployed();

    const expectedSmartAccountAddress =
            await walletFactoryV1.getAddressForCounterFactualAccount(smartAccountOwner.address, 0);
        
    await walletFactoryV1.deployCounterFactualAccount(smartAccountOwner.address, 0);

    const userSAV1 = await ethers.getContractAt(
            "contracts/smart-contract-wallet/test/upgrades/v1/SmartAccountV1.sol:SmartAccountV1",
            expectedSmartAccountAddress
    );
    
    const eoaModule = await getEOAOwnershipRegistryModule();
    const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      
    let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );

    const smartAccountDeploymentIndex = 0;

    const userSA = await getSmartAccountWithModule(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

    await deployer.sendTransaction({
      to: userSAV1.address,
      value: ethers.utils.parseEther("10"),
    });
    
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(userSAV1.address, ethers.utils.parseEther("1000000"));
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));
    
    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      eoaModule: eoaModule,
      userSA: userSA,
      userSAV1: userSAV1,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  const setupTestsAndUpgrade = async () => {
    
    const { 
      entryPoint,
      smartAccountImplementation,
      smartAccountFactory, 
      mockToken,
      eoaModule,
      userSAV1,
      verifyingPaymaster,
    } = await setupTests();

    const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
    const SmartAccountV1 = await ethers.getContractFactory("SmartAccountV1");
    const SmartAccountOwnerless = await ethers.getContractFactory("SmartAccount");

    const updateImplCallData = SmartAccountV1.interface.encodeFunctionData(
      "updateImplementation",
      [smartAccountImplementation.address]
    );

    let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [smartAccountOwner.address]
    );

    const setupAndEnableModuleCallData = SmartAccountOwnerless.interface.encodeFunctionData(
      "setupAndEnableModule",
      [
        eoaModule.address,
        eoaOwnershipSetupData
      ]
    );

    const userSAOwnerless = await ethers.getContractAt("SmartAccount", userSAV1.address);

    // UserOp calldata
    const userOpExecuteBatchCallData = SmartAccountV1.interface.encodeFunctionData(
      "executeBatchCall",
      [
        [userSAV1.address, userSAOwnerless.address],
        [ethers.utils.parseEther("0"),ethers.utils.parseEther("0")],
        [updateImplCallData, setupAndEnableModuleCallData]  
      ]
    );
    
    const userOp = await fillAndSign(
      {
          sender: userSAV1.address,
          callData: userOpExecuteBatchCallData,
          callGasLimit: 1_000_000,
      },
      smartAccountOwner,
      entryPoint,
      'nonce'
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], await alice.getAddress());
    await handleOpsTxn.wait();

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: smartAccountImplementation,
      smartAccountFactory: smartAccountFactory,
      mockToken: mockToken,
      eoaModule: eoaModule,
      userSAOwnerless: userSAOwnerless,
      verifyingPaymaster: verifyingPaymaster,
    };
  }

  it ("Can send userOp via Smart Account V1", async () => {
    
    const { 
      entryPoint, 
      mockToken,
      userSAV1,
    } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const SmartAccountV1 = await ethers.getContractFactory("SmartAccountV1");

    const txnData = SmartAccountV1.interface.encodeFunctionData("executeCall", [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
    ]);

    const userOp = await fillAndSign(
      {
        sender: userSAV1.address,
        callData: txnData,
        verificationGasLimit: 200000,
      },
      smartAccountOwner,
      entryPoint,
      'nonce'
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
    await handleOpsTxn.wait();

    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
  
  });

  it ("Can upgrade v1 to ownerless, owner info moved to module", async () => {
    
    const { 
      eoaModule,
      userSAOwnerless,
    } = await setupTestsAndUpgrade();

    expect(await userSAOwnerless.isModuleEnabled(eoaModule.address)).to.equal(true);
    expect(await eoaModule.smartAccountOwners(userSAOwnerless.address)).to.equal(smartAccountOwner.address);
  
  });

  it ("Can receive tokens to Ownerless Smart Account", async () => {

    const { userSAOwnerless, mockToken } = await setupTestsAndUpgrade();
    
    const nativeBalanceBefore = await ethers.provider.getBalance(userSAOwnerless.address);
    const tokenBalanceBefore = await mockToken.balanceOf(userSAOwnerless.address);
        
    await deployer.sendTransaction({
        to: userSAOwnerless.address,
        value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(userSAOwnerless.address, ethers.utils.parseEther("1000000"));

    const expectedNativeBalanceAfter = nativeBalanceBefore.add(ethers.utils.parseEther("10"));
    const expectedTokenBalanceAfter = tokenBalanceBefore.add(ethers.utils.parseEther("1000000"));

    expect(await ethers.provider.getBalance(userSAOwnerless.address)).to.equal(expectedNativeBalanceAfter);
    expect(await mockToken.balanceOf(userSAOwnerless.address)).to.equal(expectedTokenBalanceAfter);
  });
  
  it ("Can send userOp via Ownerless Smart Account", async () => {
    const { 
      entryPoint, 
      mockToken,
      userSAOwnerless,
      eoaModule
    } = await setupTestsAndUpgrade();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.6326");

    const userOp = await makeEOAModuleUserOp(
      "executeCall",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSAOwnerless.address,
      smartAccountOwner,
      entryPoint,
      eoaModule.address
    )

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
    await handleOpsTxn.wait();

    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));

  });

});
