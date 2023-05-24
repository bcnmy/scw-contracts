import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { buildEOAModuleAuthorizedForwardTx } from "../../src/utils/execution";
import { encodeTransfer } from "../smart-wallet/testUtils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEOAOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import { makeEOAModuleUserOp, makeEOAModuleUserOpWithPaymaster, fillAndSign } from "../utils/userOp";

describe("NEW::: Basic Gas Estimations: ", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();
  
  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();

    const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
    const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");

    const mockToken = await getMockToken();
    
    const eoaModule = await getEOAOwnershipRegistryModule();
    
    let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );

    const smartAccountDeploymentIndex = 0;

    const factory = await getSmartAccountFactory();
    const expectedSmartAccountAddress =
        await factory.getAddressForCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);
    
    const deploySATx = await factory.deployCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);
    const receipt = await deploySATx.wait();
    console.log("Gas used to directly deploy SA: ", receipt.cumulativeGasUsed.toString());
    //196694

    const userSA = await ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);

    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });

    await deployer.sendTransaction({
      to: alice.address,
      value: ethers.utils.parseEther("10"),
    });

    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));
    await mockToken.mint(charlie.address, ethers.utils.parseEther("1"));
    
    return {
      entryPoint: await getEntryPoint(),
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      eoaModule: eoaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  it ("Can deploy SA with default module", async () => {
    const { 
      mockToken,
      eoaModule,
      userSA
    } = await setupTests();

    expect(await userSA.isModuleEnabled(eoaModule.address)).to.equal(true);
    expect(await eoaModule.smartAccountOwners(userSA.address)).to.equal(smartAccountOwner.address);

    expect(await ethers.provider.getBalance(userSA.address)).to.equal(ethers.utils.parseEther("10"));
    expect(await mockToken.balanceOf(userSA.address)).to.equal(ethers.utils.parseEther("1000000"));
  });

  it ("Can send a native token transfer userOp", async () => {
    const { 
      entryPoint, 
      mockToken,
      userSA,
      eoaModule
    } = await setupTests();

    const tx = await deployer.sendTransaction({
      from: deployer.address,
      to: charlie.address,
      value: ethers.utils.parseEther("5"),
    });
    await tx.wait();

    const charlieTokenBalanceBefore = await charlie.getBalance();
    console.log("Charlie balance before: ", charlieTokenBalanceBefore.toString());
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const userOp = await makeEOAModuleUserOp(
      "executeCall",
      [
        charlie.address,
        tokenAmountToTransfer,
        "0x",
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      eoaModule.address
    )

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
    const receipt = await handleOpsTxn.wait();
    console.log("Native token transfer gas used: ", receipt.gasUsed.toString());

    expect(await charlie.getBalance()).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));

  });

  it ("Can deploy account and send a native token transfer userOp", async () => {
    const { 
      entryPoint,
      smartAccountFactory,
      eoaModule
    } = await setupTests();

    const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
    const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const charlieTokenBalanceBefore = await charlie.getBalance();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await alice.getAddress()]
    );

    const smartAccountDeploymentIndex = 0;
    
    let deploymentData = SmartAccountFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex]
    );
    
    const expectedSmartAccountAddress =
        await smartAccountFactory.getAddressForCounterFactualAccount(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("10"),
    });

    const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
      "executeCall",
      [
        charlie.address,
        tokenAmountToTransfer,
        "0x",
      ]
    );  

    const userOp = await fillAndSign(
      {
        sender: expectedSmartAccountAddress,
        callGasLimit: 1_000_000,
        initCode: ethers.utils.hexConcat([smartAccountFactory.address, deploymentData]),
        callData: txnDataAA1
      },
      alice,
      entryPoint,
      'nonce'
    );
  
    // add validator module address to the signature
    let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"], 
      [userOp.signature, eoaModule.address]
    );
  
    userOp.signature = signatureWithModuleAddress;    

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address, {
      gasLimit: 10000000,
    });
    const receipt = await handleOpsTxn.wait();
    const aliceSA = await ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);
    console.log("Deploy + token transfer userop gas used: ", receipt.gasUsed.toString());

    expect(await charlie.getBalance()).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));

  });

  it ("Can send a userOp with Paymaster payment", async () => {
    
    const { 
      entryPoint, 
      mockToken,
      userSA,
      eoaModule,
      verifyingPaymaster
    } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.6458");

    const userOp = await makeEOAModuleUserOpWithPaymaster(
      "executeCall",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      eoaModule.address,
      verifyingPaymaster,
      verifiedSigner,
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], verifiedSigner.address);
    const receipt = await handleOpsTxn.wait();
    console.log("UserOp ERC20 Token transfer with Paymaster gas used: ", receipt.gasUsed.toString());

    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
    
  });

});
