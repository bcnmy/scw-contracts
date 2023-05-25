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
import { makeEOAModuleUserOp, makeEOAModuleUserOpWithPaymaster } from "../utils/userOp";

describe("NEW::: Ownerless Smart Account Basics: ", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    await deployments.fixture();

    const mockToken = await getMockToken();
    
    const eoaModule = await getEOAOwnershipRegistryModule();
    const EOAOwnershipRegistryModule = await ethers.getContractFactory("EOAOwnershipRegistryModule");
      
    let eoaOwnershipSetupData = EOAOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );

    const smartAccountDeploymentIndex = 0;

    const userSA = await getSmartAccountWithModule(eoaModule.address, eoaOwnershipSetupData, smartAccountDeploymentIndex);

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

  it ("Can send an ERC20 Transfer userOp", async () => {
    const { 
      entryPoint, 
      mockToken,
      userSA,
      eoaModule
    } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

    const userOp = await makeEOAModuleUserOp(
      "executeCall",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      eoaModule.address
    )

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
    await handleOpsTxn.wait();

    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
  });

  it ("Can send a Native Token Transfer userOp", async () => {
    const { 
      entryPoint, 
      userSA,
      eoaModule
    } = await setupTests();

    const charlieBalanceBefore = await charlie.getBalance();
    const amountToTransfer = ethers.utils.parseEther("0.5345");

    const userOp = await makeEOAModuleUserOp(
      "executeCall",
      [
        charlie.address,
        amountToTransfer,
        "0x",
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      eoaModule.address
    );

    const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
    await handleOpsTxn.wait();
    expect(await charlie.getBalance()).to.equal(charlieBalanceBefore.add(amountToTransfer));
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
    await handleOpsTxn.wait();

    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
  });

  it ("Can verify a signature through isValidSignature", async () => {    
    const { 
      userSA,
      eoaModule
    } = await setupTests();

    const eip1271MagicValue = "0x1626ba7e";
    const message = "Some message from dApp";
    const messageHash = ethers.utils.hashMessage(message);

    const signature = await smartAccountOwner.signMessage(message);
    let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"], 
      [signature, eoaModule.address]
    );

    const returnedValue = await userSA.isValidSignature(messageHash, signatureWithModuleAddress);
    expect(returnedValue).to.be.equal(eip1271MagicValue);
  });

  it ("Can use forward flow with modules authorization", async () => { 
    const { 
      mockToken,
      userSA,
      eoaModule
    } = await setupTests();
    
    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");
    
    const { transaction, feeRefund, signature } = await buildEOAModuleAuthorizedForwardTx(
      mockToken.address,
      encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      userSA,
      smartAccountOwner,
      eoaModule.address
    );

    await expect(
      userSA.execTransaction_S6W(transaction, feeRefund, signature)
    ).to.emit(userSA, "ExecutionSuccess");

    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
  });

});
