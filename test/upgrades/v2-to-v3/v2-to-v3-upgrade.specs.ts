import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { encodeTransfer } from "../../smart-wallet/testUtils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import { fillAndSign, makeecdsaModuleUserOp, makeecdsaModuleUserOpWithPaymaster } from "../../utils/userOp";

describe("NEW::: Upgrade v2 (Ownerless) to v3", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();

    const entryPoint = await getEntryPoint();

    const mockToken = await getMockToken();

    const BaseImplementationV3 = await ethers.getContractFactory("SmartAccountV3");
    const baseImplV3 = await BaseImplementationV3.deploy(entryPoint.address);
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
            "contracts/smart-contract-wallet/test/upgrades/v3/SmartAccountV3.sol:SmartAccountV3",
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

  it ("test test", async () => {
    
    const { 
      ecdsaModule,
      userSA,
      userSAV3,
      entryPoint,
      mockToken
    } = await setupTests();

    //enable two fake modules
    // TODO REBUILD ENABLING MODULE AS EXTERNAL FUNCTION
    
    const MockHookModule = await ethers.getContractFactory("MockHookModule");
    const mockHookModule1 = await MockHookModule.deploy();
    const mockHookModule2 = await MockHookModule.deploy();

    const SpendingLimitsModule = await ethers.getContractFactory("SpendingLimitsModule");
    const spendingLimitsModule = await SpendingLimitsModule.deploy(mockToken.address);

    // Deploy spender module
    const SpenderModule = await ethers.getContractFactory("SpenderModule");
    const spenderModule = await SpenderModule.deploy();

    const userOp = await makeecdsaModuleUserOp(
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

    const userOp2 = await makeecdsaModuleUserOp(
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

    const userOp3 = await makeecdsaModuleUserOp(
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

    const userOp4 = await makeecdsaModuleUserOp(
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
    
    //make set limit userOp
    const userOp5 = await makeecdsaModuleUserOp(
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
    console.log("leftToSpend", leftToSpend.toString());
    expect (leftToSpend).to.equal(ethers.utils.parseEther("0"));

    await expect(
      spenderModule.spend(mockToken.address, charlie.address, ethers.utils.parseEther("10"), userSAV3.address)
    ).to.be.revertedWith("Spending limit exceeded");
  
  });

});
