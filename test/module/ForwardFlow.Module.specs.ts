import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, deployments, waffle } from "hardhat";
import {
  buildEcdsaModuleAuthorizedForwardTx,
  buildSafeTransaction,
  getTransactionAndRefundInfoFromSafeTransactionObject,
  SafeTransaction,
  safeSignTypedData,
  safeSignMessage,
  FORWARD_FLOW,
} from "../../src/utils/execution";
import { makeEcdsaModuleUserOp } from "../utils/userOp";
import { encodeTransfer } from "../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";

describe("Forward Flow Module", async () => {
  const [
    deployer,
    smartAccountOwner,
    alice,
    charlie,
    verifiedSigner,
    refundReceiver,
  ] = waffle.provider.getWallets();
  let erc20TransferForwardTxnNoRefundGasCost = BigNumber.from("0");
  let forwardFlowModule: Contract;

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const mockToken = await getMockToken();
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
      "EcdsaOwnershipRegistryModule"
    );
    const ecdsaOwnershipSetupData =
      EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await smartAccountOwner.getAddress()]
      );
    const smartAccountDeploymentIndex = 0;
    const userSA = await getSmartAccountWithModule(
      ecdsaModule.address,
      ecdsaOwnershipSetupData,
      smartAccountDeploymentIndex
    );

    // send funds to userSA and mint tokens
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    // deploy forward flow module and enable it in the smart account
    forwardFlowModule = await (
      await ethers.getContractFactory("ForwardFlowModule")
    ).deploy();
    const userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [forwardFlowModule.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    await entryPoint.handleOps([userOp], alice.address);

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
    };
  });

  it("Module is enabled", async () => {
    const { userSA } = await setupTests();
    expect(await userSA.isModuleEnabled(forwardFlowModule.address)).to.equal(
      true
    );
  });

  it("Can process EIP712-signed txn with value (native token transfer)", async () => {
    const { userSA, ecdsaModule } = await setupTests();

    const charlieBalanceBefore = await charlie.getBalance();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.167924");

    const { transaction, feeRefund, signature } =
      await buildEcdsaModuleAuthorizedForwardTx(
        charlie.address,
        "0x",
        userSA,
        smartAccountOwner,
        ecdsaModule.address,
        forwardFlowModule,
        tokenAmountToTransfer.toString()
      );

    await expect(
      forwardFlowModule.execTransaction(
        userSA.address,
        transaction,
        feeRefund,
        signature
      )
    ).to.emit(userSA, "ExecutionSuccess");
    expect(await charlie.getBalance()).to.equal(
      charlieBalanceBefore.add(tokenAmountToTransfer)
    );
  });

  it("Can process EIP712-signed txn with data (ERC20 token transfer)", async () => {
    const { mockToken, userSA, ecdsaModule } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");

    const { transaction, feeRefund, signature } =
      await buildEcdsaModuleAuthorizedForwardTx(
        mockToken.address,
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        userSA,
        smartAccountOwner,
        ecdsaModule.address,
        forwardFlowModule
      );

    const tx = await forwardFlowModule.execTransaction(
      userSA.address,
      transaction,
      feeRefund,
      signature
    );
    await expect(tx).to.emit(userSA, "ExecutionSuccess");
    const receipt = await tx.wait();
    // record gas cost for later tests
    erc20TransferForwardTxnNoRefundGasCost = receipt.gasUsed;
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });

  it("Can not process txn with the same nonce twice", async () => {
    const { mockToken, userSA, ecdsaModule } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");

    const { transaction, feeRefund, signature } =
      await buildEcdsaModuleAuthorizedForwardTx(
        mockToken.address,
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        userSA,
        smartAccountOwner,
        ecdsaModule.address,
        forwardFlowModule
      );

    await expect(
      forwardFlowModule.execTransaction(
        userSA.address,
        transaction,
        feeRefund,
        signature
      )
    ).to.emit(userSA, "ExecutionSuccess");
    await expect(
      forwardFlowModule.execTransaction(
        userSA.address,
        transaction,
        feeRefund,
        signature
      )
    ).to.be.revertedWith("InvalidSignature");
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer.mul(1))
    );
  });

  it("Can not process txn with wrong nonce", async () => {
    const { mockToken, userSA, ecdsaModule } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");

    const invalidNonce = (await forwardFlowModule.getNonce(FORWARD_FLOW)).add(
      1
    );

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: mockToken.address,
      data: encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      nonce: invalidNonce,
    });

    const chainId = await forwardFlowModule.getChainId();
    const { data } = await safeSignTypedData(
      smartAccountOwner,
      userSA,
      safeTx,
      chainId
    );

    const { transaction, refundInfo } =
      await getTransactionAndRefundInfoFromSafeTransactionObject(safeTx);

    let signature = "0x";
    signature += data.slice(2);

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [signature, ecdsaModule.address]
    );

    await expect(
      forwardFlowModule.execTransaction(
        userSA.address,
        transaction,
        refundInfo,
        signatureWithModuleAddress
      )
    ).to.be.revertedWith("InvalidSignature");
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore
    );
  });

  it("Can process two consecutive txns", async () => {
    const { mockToken, userSA, ecdsaModule } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");

    const { transaction, feeRefund, signature } =
      await buildEcdsaModuleAuthorizedForwardTx(
        mockToken.address,
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        userSA,
        smartAccountOwner,
        ecdsaModule.address,
        forwardFlowModule
      );
    await expect(
      forwardFlowModule.execTransaction(
        userSA.address,
        transaction,
        feeRefund,
        signature
      )
    ).to.emit(userSA, "ExecutionSuccess");

    const tokenAmountToTransfer2 = ethers.utils.parseEther("0.5555");
    const {
      transaction: transaction2,
      feeRefund: feeRefund2,
      signature: signature2,
    } = await buildEcdsaModuleAuthorizedForwardTx(
      mockToken.address,
      encodeTransfer(charlie.address, tokenAmountToTransfer2.toString()),
      userSA,
      smartAccountOwner,
      ecdsaModule.address,
      forwardFlowModule
    );
    await expect(
      forwardFlowModule.execTransaction(
        userSA.address,
        transaction2,
        feeRefund2,
        signature2
      )
    ).to.emit(userSA, "ExecutionSuccess");

    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore
        .add(tokenAmountToTransfer)
        .add(tokenAmountToTransfer2)
    );
  });

  /*
  it("Can process Personal-signed txn", async () => {
      // DEPRECATED
      // Only signatures over typed data hash are expected by this module
      // because of the way it reconstructs hash to verify the signature
  }); 
  */

  it("Can process eth_signed txn via dedicated module", async () => {
    const { mockToken, userSA, ecdsaModule, entryPoint } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");

    const EthSignCompatibleECDSAModule = await ethers.getContractFactory(
      "EcdsaWithEthSignSupportOwnershipRegistryModule"
    );
    const ethSignCompatibleECDSAModule =
      await EthSignCompatibleECDSAModule.deploy();
    const ethSignCompatibleECDSASetupData =
      EthSignCompatibleECDSAModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [smartAccountOwner.address]
      );
    const enableModuleUserOp = await makeEcdsaModuleUserOp(
      "setupAndEnableModule",
      [ethSignCompatibleECDSAModule.address, ethSignCompatibleECDSASetupData],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    const tx = await entryPoint.handleOps([enableModuleUserOp], alice.address);
    await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");
    expect(
      await userSA.isModuleEnabled(ethSignCompatibleECDSAModule.address)
    ).to.equal(true);

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: mockToken.address,
      data: encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      nonce: await forwardFlowModule.getNonce(FORWARD_FLOW),
    });

    const chainId = await forwardFlowModule.getChainId();
    const { data } = await safeSignMessage(
      smartAccountOwner,
      userSA,
      safeTx,
      chainId
    );

    const { transaction, refundInfo } =
      getTransactionAndRefundInfoFromSafeTransactionObject(safeTx);

    let signature = "0x";
    signature += data.slice(2);

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [signature, ethSignCompatibleECDSAModule.address]
    );

    await expect(
      forwardFlowModule.execTransaction(
        userSA.address,
        transaction,
        refundInfo,
        signatureWithModuleAddress
      )
    ).to.emit(userSA, "ExecutionSuccess");
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });

  it("Can not process eth_signed txn via regular ecdsa module", async () => {
    const { mockToken, userSA, ecdsaModule } = await setupTests();

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const tokenAmountToTransfer = ethers.utils.parseEther("0.13924");

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: mockToken.address,
      data: encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      nonce: await forwardFlowModule.getNonce(FORWARD_FLOW),
    });

    const chainId = await forwardFlowModule.getChainId();
    const { data } = await safeSignMessage(
      smartAccountOwner,
      userSA,
      safeTx,
      chainId
    );

    const { transaction, refundInfo } =
      getTransactionAndRefundInfoFromSafeTransactionObject(safeTx);

    let signature = "0x";
    signature += data.slice(2);

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [signature, ecdsaModule.address]
    );

    await expect(
      forwardFlowModule.execTransaction(
        userSA.address,
        transaction,
        refundInfo,
        signatureWithModuleAddress
      )
    ).to.be.revertedWith("ECDSA: invalid signature");
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore
    );
  });

  it("can send transactions and charge smart account for fees in native tokens", async function () {
    const { userSA, ecdsaModule, mockToken } = await setupTests();
    const balanceRRBefore = await refundReceiver.getBalance();

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: mockToken.address,
      data: encodeTransfer(
        charlie.address,
        ethers.utils.parseEther("10").toString()
      ),
      nonce: await forwardFlowModule.getNonce(FORWARD_FLOW),
    });
    const gasEstimation = await ethers.provider.estimateGas({
      to: mockToken.address,
      data: encodeTransfer(
        charlie.address,
        ethers.utils.parseEther("10").toString()
      ),
      from: userSA.address,
    });

    safeTx.refundReceiver = "0x0000000000000000000000000000000000000000";
    safeTx.gasToken = "0x0000000000000000000000000000000000000000";
    safeTx.gasPrice = 10000000000;
    safeTx.targetTxGas = gasEstimation.toNumber();
    safeTx.baseGas = 21000 + +15000 + 21000 + 25000; // base + cost of execTransactionFromModule + eth transfer  + ~cost of _handlePayment itself

    const { data } = await safeSignTypedData(
      smartAccountOwner,
      userSA,
      safeTx,
      await forwardFlowModule.getChainId()
    );

    let signature = "0x";
    signature += data.slice(2);
    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [signature, ecdsaModule.address]
    );

    const { transaction, refundInfo } =
      getTransactionAndRefundInfoFromSafeTransactionObject(safeTx);

    const tx = await forwardFlowModule
      .connect(refundReceiver)
      .execTransaction(
        userSA.address,
        transaction,
        refundInfo,
        signatureWithModuleAddress,
        {
          gasPrice: safeTx.gasPrice,
        }
      );
    await expect(tx).to.emit(userSA, "ExecutionSuccess");
    const receipt = await tx.wait();

    const gasPaidForTx = receipt.gasUsed.mul(safeTx.gasPrice);
    const expectedRRBalanceAfterPayingForTx = balanceRRBefore.sub(gasPaidForTx);
    const defactoRRBalanceAfterPayingForTx = await refundReceiver.getBalance();

    // console.log("gas used", receipt.gasUsed.toString());
    // console.log("Gas used in ETH", ethers.utils.formatEther(receipt.gasUsed.mul(safeTx.gasPrice)));
    // console.log("Balances difference ", ethers.utils.formatEther(balanceRRBefore.sub(await refundReceiver.getBalance())));

    // if defacto Refund Receiver (RR) balance is higher than expected, it means that some refund was received
    expect(
      defactoRRBalanceAfterPayingForTx.gt(expectedRRBalanceAfterPayingForTx)
    ).to.equal(true);
  });

  it("can send transactions and charge smart account for fees in ERC20 tokens", async function () {
    const { userSA, ecdsaModule, mockToken } = await setupTests();

    const balanceRRBefore = await mockToken.balanceOf(refundReceiver.address);

    const safeTx: SafeTransaction = buildSafeTransaction({
      to: mockToken.address,
      data: encodeTransfer(
        charlie.address,
        ethers.utils.parseEther("10").toString()
      ),
      nonce: await forwardFlowModule.getNonce(FORWARD_FLOW),
    });
    const gasEstimation1 = await ethers.provider.estimateGas({
      to: mockToken.address,
      data: encodeTransfer(
        charlie.address,
        ethers.utils.parseEther("10").toString()
      ),
      from: userSA.address,
    });

    safeTx.refundReceiver = "0x0000000000000000000000000000000000000000";
    safeTx.gasToken = mockToken.address;
    safeTx.gasPrice = 10000000000;

    const approxRefundAmount = erc20TransferForwardTxnNoRefundGasCost
      .add(25000)
      .add(gasEstimation1); // forward tx cost + handle payment cost + erc20 refund cost

    // estimate refund
    const gasEstimation2 = await ethers.provider.estimateGas({
      to: mockToken.address,
      data: encodeTransfer(userSA.address, approxRefundAmount.toString()),
      from: userSA.address,
    });

    safeTx.targetTxGas = gasEstimation1.toNumber(); // gas spent to target txn itself
    safeTx.baseGas = 21000 + (gasEstimation2.toNumber() - 21000 + 55000); // additional gas: (base) + (refund erc20 token transfer - base) + ~(_handlePayment cost)

    const { data } = await safeSignTypedData(
      smartAccountOwner,
      userSA,
      safeTx,
      await forwardFlowModule.getChainId()
    );

    let signature = "0x";
    signature += data.slice(2);
    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [signature, ecdsaModule.address]
    );

    const { transaction, refundInfo } =
      getTransactionAndRefundInfoFromSafeTransactionObject(safeTx);
    const tx = await forwardFlowModule
      .connect(refundReceiver)
      .execTransaction(
        userSA.address,
        transaction,
        refundInfo,
        signatureWithModuleAddress,
        {
          gasPrice: safeTx.gasPrice,
        }
      );
    await expect(tx).to.emit(userSA, "ExecutionSuccess");

    const balanceRRAfter = await mockToken.balanceOf(refundReceiver.address);
    expect(balanceRRAfter.gt(balanceRRBefore)).to.equal(true);

    // const receipt = await tx.wait();
    // console.log("Gas used in Token ", ethers.utils.formatEther(receipt.gasUsed.mul(safeTx.gasPrice))); // 1 MockToken = 1 ETH
    // console.log("Refund amount is: ", ethers.utils.formatEther(balanceRRAfter.sub(balanceRRBefore)));
  });
});
