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

    const eoaModule = await getEOAOwnershipRegistryModule();
    const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      
    let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );

    const smartAccountDeploymentIndex = 0;

    const expectedSmartAccountAddressV3 =
            await walletFactoryV3.getAddressForCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);
        
    await walletFactoryV3.deployCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

    const userSAV3 = await ethers.getContractAt(
            "contracts/smart-contract-wallet/test/upgrades/v3/SmartAccountV3.sol:SmartAccountV3",
            expectedSmartAccountAddressV3
    );
    
    const userSA = await getSmartAccountWithModule(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

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
      eoaModule: eoaModule,
      userSA: userSA,
      userSAV3: userSAV3,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  it ("test test", async () => {
    
    const { 
      eoaModule,
      userSA,
      userSAV3,
      entryPoint
    } = await setupTests();

    //enable two fake modules
    // TODO REBUILD ENABLING MODULE AS EXTERNAL FUNCTION
    
    const MockHookModule = await ethers.getContractFactory("MockHookModule");
    const mockHookModule1 = await MockHookModule.deploy();
    const mockHookModule2 = await MockHookModule.deploy();

    //const fakeModule1 = "0xffffffffffffffffffffffffffffffffffff1846";
    //const fakeModule2 = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeee9524";

    const userOp = await makeEOAModuleUserOp(
      "enableModule",
      [
        mockHookModule1.address
      ],
      userSAV3.address,
      smartAccountOwner,
      entryPoint,
      eoaModule.address
    )
    await entryPoint.handleOps([userOp], alice.address);

    const userOp2 = await makeEOAModuleUserOp(
      "enableModule",
      [
        mockHookModule2.address
      ],
      userSAV3.address,
      smartAccountOwner,
      entryPoint,
      eoaModule.address
    )
    await entryPoint.handleOps([userOp2], alice.address);

    const userOp3 = await makeEOAModuleUserOp(
      "executeCall_s1m",
      [
        charlie.address,
        ethers.utils.parseEther("0.11"),
        "0x"
      ],
      userSAV3.address,
      smartAccountOwner,
      entryPoint,
      eoaModule.address
      //"0x0000000000000000000000000000000000000001"
    )
    await entryPoint.handleOps([userOp3], alice.address);
    //await expect(entryPoint.handleOps([userOp3], alice.address)).to.be.reverted;


  
  });

});
