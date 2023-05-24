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

describe("NEW::: Smart Account Forward Flow: ", async () => {

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

  it ("Can use forward flow with authorization modules", async () => { 
    
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
