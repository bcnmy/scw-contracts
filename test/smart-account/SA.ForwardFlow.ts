import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { buildEOAModuleAuthorizedForwardTx, buildSafeTransaction, SafeTransaction, safeSignTypedData, Transaction, FeeRefund, FORWARD_FLOW } from "../../src/utils/execution";
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

describe("NEW::: Smart Account Forward Flow", async () => {

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

  it ("Can process txn with value (native token transfer)", async () => { 
    const { 
      userSA,
      eoaModule
    } = await setupTests();
    
    const charlieBalanceBefore = await charlie.getBalance();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.167924");
    
    const { transaction, feeRefund, signature } = await buildEOAModuleAuthorizedForwardTx(
      charlie.address,
      "0x",
      userSA,
      smartAccountOwner,
      eoaModule.address,
      tokenAmountToTransfer.toString(),
    );

    await expect(
      userSA.execTransaction_S6W(transaction, feeRefund, signature)
    ).to.emit(userSA, "ExecutionSuccess");
    expect(await charlie.getBalance()).to.equal(charlieBalanceBefore.add(tokenAmountToTransfer));

  });

  it ("Can process txn with data (ERC20 token transfer)", async () => { 
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

  it ("Can not process txn with the same nonce twice", async () => { 
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
    await expect(
      userSA.execTransaction_S6W(transaction, feeRefund, signature)
    ).to.be.revertedWith("InvalidSignature");
    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer.mul(1)));
  });

  it ("Can not process txn with wrong nonce" , async () => {
      const { 
        mockToken,
        userSA,
        eoaModule
      } = await setupTests();
      
      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");

      const invalidNonce = await userSA.getNonce(FORWARD_FLOW) + 1;
      
      const safeTx: SafeTransaction = buildSafeTransaction({
        to: mockToken.address,
        data: encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        nonce: invalidNonce,
      });
  
      const chainId = await userSA.getChainId();
      const { signer, data } = await safeSignTypedData(
        smartAccountOwner,
        userSA,
        safeTx,
        chainId
      );
  
      console.log(safeTx);
  
      const transaction: Transaction = {
        to: safeTx.to,
        value: safeTx.value,
        data: safeTx.data,
        operation: safeTx.operation,
        targetTxGas: safeTx.targetTxGas,
      };
      const refundInfo: FeeRefund = {
        baseGas: safeTx.baseGas,
        gasPrice: safeTx.gasPrice,
        tokenGasPriceFactor: safeTx.tokenGasPriceFactor,
        gasToken: safeTx.gasToken,
        refundReceiver: safeTx.refundReceiver,
      };
  
      let signature = "0x";
      signature += data.slice(2);
      
      let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"], 
        [signature, eoaModule.address]
      );
  
      await expect(
        userSA.execTransaction_S6W(transaction, refundInfo, signatureWithModuleAddress)
      ).to.be.revertedWith("InvalidSignature");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore);
  });

  it ("Can process two consecutive txns", async () => { 
    const { 
      mockToken,
      userSA,
      eoaModule
    } = await setupTests();
    
    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");
    
    let { transaction, feeRefund, signature } = await buildEOAModuleAuthorizedForwardTx(
      mockToken.address,
      encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      userSA,
      smartAccountOwner,
      eoaModule.address
    );
    await expect(
      userSA.execTransaction_S6W(transaction, feeRefund, signature)
    ).to.emit(userSA, "ExecutionSuccess");

    const tokenAmountToTransfer2 = ethers.utils.parseEther("0.5555");
    let { transaction: transaction2, feeRefund: feeRefund2, signature: signature2 } = await buildEOAModuleAuthorizedForwardTx(
      mockToken.address,
      encodeTransfer(charlie.address, tokenAmountToTransfer2.toString()),
      userSA,
      smartAccountOwner,
      eoaModule.address
    );  
    await expect(
      userSA.execTransaction_S6W(transaction2, feeRefund2, signature2)
    ).to.emit(userSA, "ExecutionSuccess");

    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer).add(tokenAmountToTransfer2));
  });


});
