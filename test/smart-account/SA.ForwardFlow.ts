import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, deployments, waffle } from "hardhat";
import { 
  buildecdsaModuleAuthorizedForwardTx, 
  buildSafeTransaction, 
  getTransactionAndRefundInfoFromSafeTransactionObject, 
  SafeTransaction, 
  safeSignTypedData, 
  safeSignMessage, 
  Transaction, 
  FeeRefund, 
  FORWARD_FLOW 
} from "../../src/utils/execution";
import { encodeTransfer } from "../smart-wallet/testUtils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";

describe("NEW::: Smart Account Forward Flow", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner, refundReceiver] = waffle.provider.getWallets();
  let erc20TransferForwardTxnNoRefundGasCost = BigNumber.from("0");

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

  it ("Can process EIP712-signed txn with value (native token transfer)", async () => { 
    const { 
      userSA,
      ecdsaModule
    } = await setupTests();
    
    const charlieBalanceBefore = await charlie.getBalance();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.167924");
    
    const { transaction, feeRefund, signature } = await buildecdsaModuleAuthorizedForwardTx(
      charlie.address,
      "0x",
      userSA,
      smartAccountOwner,
      ecdsaModule.address,
      tokenAmountToTransfer.toString(),
    );
    
    await expect(
      userSA.execTransaction_S6W(transaction, feeRefund, signature)
    ).to.emit(userSA, "ExecutionSuccess");
    expect(await charlie.getBalance()).to.equal(charlieBalanceBefore.add(tokenAmountToTransfer));

  });

  it ("Can process EIP712-signed txn with data (ERC20 token transfer)", async () => { 
    const { 
      mockToken,
      userSA,
      ecdsaModule
    } = await setupTests();
    
    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");
    
    const { transaction, feeRefund, signature } = await buildecdsaModuleAuthorizedForwardTx(
      mockToken.address,
      encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      userSA,
      smartAccountOwner,
      ecdsaModule.address
    );

    const tx = await userSA.execTransaction_S6W(transaction, feeRefund, signature);
    await expect(tx).to.emit(userSA, "ExecutionSuccess");
    const receipt = await tx.wait();
    erc20TransferForwardTxnNoRefundGasCost = receipt.gasUsed;
    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
  });

  it ("Can not process txn with the same nonce twice", async () => { 
    const { 
      mockToken,
      userSA,
      ecdsaModule
    } = await setupTests();
    
    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");
    
    const { transaction, feeRefund, signature } = await buildecdsaModuleAuthorizedForwardTx(
      mockToken.address,
      encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      userSA,
      smartAccountOwner,
      ecdsaModule.address
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
        ecdsaModule
      } = await setupTests();
      
      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");

      const invalidNonce = (await userSA.getNonce(FORWARD_FLOW)).add(1);
      
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
  
      const {transaction, refundInfo} = await getTransactionAndRefundInfoFromSafeTransactionObject(safeTx);
  
      let signature = "0x";
      signature += data.slice(2);
      
      let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"], 
        [signature, ecdsaModule.address]
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
      ecdsaModule
    } = await setupTests();
    
    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");
    
    let { transaction, feeRefund, signature } = await buildecdsaModuleAuthorizedForwardTx(
      mockToken.address,
      encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      userSA,
      smartAccountOwner,
      ecdsaModule.address
    );
    await expect(
      userSA.execTransaction_S6W(transaction, feeRefund, signature)
    ).to.emit(userSA, "ExecutionSuccess");

    const tokenAmountToTransfer2 = ethers.utils.parseEther("0.5555");
    let { transaction: transaction2, feeRefund: feeRefund2, signature: signature2 } = await buildecdsaModuleAuthorizedForwardTx(
      mockToken.address,
      encodeTransfer(charlie.address, tokenAmountToTransfer2.toString()),
      userSA,
      smartAccountOwner,
      ecdsaModule.address
    );  
    await expect(
      userSA.execTransaction_S6W(transaction2, feeRefund2, signature2)
    ).to.emit(userSA, "ExecutionSuccess");

    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer).add(tokenAmountToTransfer2));
  });

  it("Can process Personal-signed txn", async () => {
    const { 
      mockToken,
      userSA,
      ecdsaModule
    } = await setupTests();
    
    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");
    
    const safeTx: SafeTransaction = buildSafeTransaction({
      to: mockToken.address,
      data: encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      nonce: await userSA.getNonce(FORWARD_FLOW),
    });

    const chainId = await userSA.getChainId();
    const { signer, data } = await safeSignMessage(
      smartAccountOwner,
      userSA,
      safeTx,
      chainId
    );

    const {transaction, refundInfo} = getTransactionAndRefundInfoFromSafeTransactionObject(safeTx);

    let signature = "0x";
    signature += data.slice(2);
    
    let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"], 
      [signature, ecdsaModule.address]
    );

    await expect(
      userSA.execTransaction_S6W(transaction, refundInfo, signatureWithModuleAddress)
    ).to.emit(userSA, "ExecutionSuccess");
    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
  }); 

  it("can send transactions and charge smart account for fees in native tokens", async function () {
    const { 
      userSA,
      ecdsaModule,
      mockToken,
    } = await setupTests();
    const balanceRRBefore = await refundReceiver.getBalance();

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: mockToken.address,
      data: encodeTransfer(charlie.address, ethers.utils.parseEther("10").toString()),
      nonce: await userSA.getNonce(FORWARD_FLOW),
    });
    const gasEstimation = await ethers.provider.estimateGas({
      to: mockToken.address,
      data: encodeTransfer(charlie.address, ethers.utils.parseEther("10").toString()),
      from: userSA.address,
    });

    safeTx.refundReceiver = "0x0000000000000000000000000000000000000000";
    safeTx.gasToken = "0x0000000000000000000000000000000000000000";
    safeTx.gasPrice = 10000000000;
    safeTx.targetTxGas = gasEstimation.toNumber();
    safeTx.baseGas = 21000 + 21000 + 25000; // base + eth transfer + ~cost of handlePayment itself

    const { signer, data } = await safeSignTypedData(
      smartAccountOwner,
      userSA,
      safeTx,
      await userSA.getChainId()
    );

    let signature = "0x";
    signature += data.slice(2);
    let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"], 
      [signature, ecdsaModule.address]
    );

    const {transaction, refundInfo} = getTransactionAndRefundInfoFromSafeTransactionObject(safeTx);

    const tx = await userSA
      .connect(refundReceiver)
      .execTransaction_S6W(transaction, refundInfo, signatureWithModuleAddress, {
        gasPrice: safeTx.gasPrice,
      }
    );
    await expect(tx).to.emit(userSA, "ExecutionSuccess");
    const receipt = await tx.wait();

    const gasPaidForTx = receipt.gasUsed.mul(safeTx.gasPrice);
    const expectedRRBalanceAfterPayingForTx = balanceRRBefore.sub(gasPaidForTx);
    const defactoRRBalanceAfterPayingForTx = await refundReceiver.getBalance();
    
    /*
    console.log("gas used", receipt.gasUsed.toString());
    console.log("Gas used in ETH", ethers.utils.formatEther(receipt.gasUsed.mul(safeTx.gasPrice)));
    console.log("Balances difference ", ethers.utils.formatEther(balanceRRBefore.sub(await refundReceiver.getBalance())));
    //if balances difference is less than gas used, it means that some refund was received
    */

    //if defacto Refund Receiver (RR) balance is higher than expected, it means that some refund was received

    expect(defactoRRBalanceAfterPayingForTx.gt(expectedRRBalanceAfterPayingForTx)).to.be.true;
  });

  it("can send transactions and charge smart account for fees in ERC20 tokens", async function () {
    const { 
      userSA,
      ecdsaModule,
      mockToken,
    } = await setupTests();

    const balanceRRBefore = await mockToken.balanceOf(refundReceiver.address);

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: mockToken.address,
      data: encodeTransfer(charlie.address, ethers.utils.parseEther("10").toString()),
      nonce: await userSA.getNonce(FORWARD_FLOW),
    });
    const gasEstimation1 = await ethers.provider.estimateGas({
      to: mockToken.address,
      data: encodeTransfer(charlie.address, ethers.utils.parseEther("10").toString()),
      from: userSA.address,
    });

    safeTx.refundReceiver = "0x0000000000000000000000000000000000000000";
    safeTx.gasToken = mockToken.address;
    safeTx.gasPrice = 10000000000;

    const approxRefundAmount =  erc20TransferForwardTxnNoRefundGasCost.add(25000).add(gasEstimation1);  //forward tx cost + handle payment cost + erc20 refund cost

    //estimate refund
    const gasEstimation2 = await ethers.provider.estimateGas({
      to: mockToken.address,
      data: encodeTransfer(userSA.address, approxRefundAmount.toString()),
      from: userSA.address,
    });

    safeTx.targetTxGas = gasEstimation1.toNumber(); // gas spent to target txn itself
    safeTx.baseGas = 21000 + (gasEstimation2.toNumber() - 21000 + 55000); // additional gas: (base) + (refund erc20 token transfer - base) + ~(handlePayment cost)

    const { signer, data } = await safeSignTypedData(
      smartAccountOwner,
      userSA,
      safeTx,
      await userSA.getChainId()
    );

    let signature = "0x";
    signature += data.slice(2);
    let signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"], 
      [signature, ecdsaModule.address]
    );

    const {transaction, refundInfo} = getTransactionAndRefundInfoFromSafeTransactionObject(safeTx);
    const tx = await userSA
      .connect(refundReceiver)
      .execTransaction_S6W(transaction, refundInfo, signatureWithModuleAddress, {
        gasPrice: safeTx.gasPrice,
      }
    );
    await expect(tx).to.emit(userSA, "ExecutionSuccess");

    const balanceRRAfter = await mockToken.balanceOf(refundReceiver.address);
    expect(balanceRRAfter.gt(balanceRRBefore)).to.be.true;

    //const receipt = await tx.wait();
    //console.log("Gas used in Token ", ethers.utils.formatEther(receipt.gasUsed.mul(safeTx.gasPrice))); // 1 MockToken = 1 ETH
    //console.log("Refund amount is: ", ethers.utils.formatEther(balanceRRAfter.sub(balanceRRBefore)));
  });


});
