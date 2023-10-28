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
  getSimpleExecutionModule,
  getStakedSmartAccountFactory,
} from "../utils/setupHelper";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const feeCollector = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
const AddressOne = "0x0000000000000000000000000000000000000001";

describe("ECDSA Registry Validation + Simple Execution Module", async () => {
  let [deployer, smartAccountOwner, bob, alice] = [] as SignerWithAddress[];
  const smartAccountDeploymentIndex = 0;

  beforeEach(async function () {
    [deployer, smartAccountOwner, bob, alice] = await ethers.getSigners();
  });

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const mockToken = await getMockToken();
    const entryPoint = await getEntryPoint();
    const saFactory = await getStakedSmartAccountFactory();
    const ecdsaRegistryModule = await getEcdsaOwnershipRegistryModule();
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();

    const ecdsaOwnershipSetupData =
      ecdsaRegistryModule.interface.encodeFunctionData("initForSmartAccount", [
        await smartAccountOwner.getAddress(),
      ]);

    const userSA = await getSmartAccountWithModule(
      ecdsaRegistryModule.address,
      ecdsaOwnershipSetupData,
      smartAccountDeploymentIndex
    );

    // send funds to userSA and mint tokens
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    const mockWrapper = await (
      await ethers.getContractFactory("MockWrapper")
    ).deploy();

    // deploy simple execution module and enable it in the smart account
    const delegateCallModule = await (
      await ethers.getContractFactory("SimpleExecutionModule")
    ).deploy();
    // ^ or use await getSimpleExecutionModule();

    const userOp1 = await makeEcdsaModuleUserOp(
      "enableModule",
      [delegateCallModule.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaRegistryModule.address
    );

    await entryPoint.handleOps([userOp1], bob.address);

    const tokensToMint = ethers.utils.parseEther("100");
    await mockToken.mint(bob.address, tokensToMint.toString());

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      saFactory: saFactory,
      ecdsaRegistryModule: ecdsaRegistryModule,
      ecdsaOwnershipSetupData: ecdsaOwnershipSetupData,
      delegateCallModule: delegateCallModule,
      mockWrapper: mockWrapper,
      userSA: userSA,
      mockToken: mockToken,
    };
  });

  it("validate using ecdsa and call enabled delegate call module for simple execution", async () => {
    const {
      ecdsaRegistryModule,
      entryPoint,
      userSA,
      delegateCallModule,
      mockWrapper,
      mockToken,
    } = await setupTests();

    // simple execution module should have been enabled
    expect(await userSA.isModuleEnabled(delegateCallModule.address)).to.equal(
      true
    );

    // ecdsa module should have been enabled as default auth module
    expect(await userSA.isModuleEnabled(ecdsaRegistryModule.address)).to.equal(
      true
    );

    const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
    const bobBalanceBefore = await mockToken.balanceOf(bob.address);
    const feeCollctorBalanceBefore = await mockToken.balanceOf(feeCollector);

    const totalTokensToTransfer = ethers.utils.parseEther("30");

    const wrapperCallData = mockWrapper.interface.encodeFunctionData(
      "interact",
      [mockToken.address, bob.address, totalTokensToTransfer]
    );

    // type Transaction without targetTxGas
    const transaction: any = {
      to: mockWrapper.address,
      value: "0",
      data: wrapperCallData,
      operation: 1, // dalegate call
    };

    // Calldata to send tokens using a wrapper
    const txnData1 = delegateCallModule.interface.encodeFunctionData(
      "execTransaction",
      [transaction]
    );
    const userOp = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [delegateCallModule.address, 0, txnData1],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaRegistryModule.address,
      {
        preVerificationGas: 50000,
      }
    );

    await entryPoint.handleOps([userOp], bob.address);

    // expect(thrownError).to.deep.equal(expectedError);

    // 2/3 or totalTokensToTransfer because MockWrapper takes 1/3 as fee
    expect(await mockToken.balanceOf(bob.address)).to.equal(
      bobBalanceBefore.add(
        totalTokensToTransfer.sub(totalTokensToTransfer.div(BigNumber.from(3)))
      )
    );

    expect(await mockToken.balanceOf(userSA.address)).to.equal(
      userSABalanceBefore.sub(totalTokensToTransfer)
    );

    // mock wrapper collects 1/3 or totalTokensToTransfer as fee
    expect(await mockToken.balanceOf(feeCollector)).to.equal(
      feeCollctorBalanceBefore.add(totalTokensToTransfer.div(BigNumber.from(3)))
    );
  });

  it("Can not process the transaction if module is not enabled", async () => {
    const {
      ecdsaRegistryModule,
      entryPoint,
      userSA,
      delegateCallModule,
      mockWrapper,
      mockToken,
    } = await setupTests();

    // simple execution module should have been enabled
    expect(await userSA.isModuleEnabled(delegateCallModule.address)).to.equal(
      true
    );

    // ecdsa module should have been enabled as default auth module
    expect(await userSA.isModuleEnabled(ecdsaRegistryModule.address)).to.equal(
      true
    );

    const feeCollctorBalanceBefore = await mockToken.balanceOf(feeCollector);

    // Making a tx to disable a module
    const userOp1 = await makeEcdsaModuleUserOp(
      "disableModule",
      [AddressOne, delegateCallModule.address], // in order to remove last added module prevModule would be Sentinel
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaRegistryModule.address,
      {
        preVerificationGas: 50000,
      }
    );

    await entryPoint.handleOps([userOp1], bob.address);

    // Module should have been disabled correctly
    expect(await userSA.isModuleEnabled(delegateCallModule.address)).to.equal(
      false
    );

    // Making the transaction using a module which should technically fail
    const wrapperCallData = mockWrapper.interface.encodeFunctionData(
      "interact",
      [mockToken.address, bob.address, ethers.utils.parseEther("30")]
    );

    // type Transaction without targetTxGas
    const transaction: any = {
      to: mockWrapper.address,
      value: "0",
      data: wrapperCallData,
      operation: 1, // dalegate call
    };

    // Calldata to send tokens using a wrapper
    const txnData1 = delegateCallModule.interface.encodeFunctionData(
      "execTransaction",
      [transaction]
    );

    const userOp = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [delegateCallModule.address, 0, txnData1],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaRegistryModule.address,
      {
        preVerificationGas: 50000,
      }
    );

    let errorInCallGasLimitEstimation = false;

    // Such transaction would fail at SDK estimation only when estimating callGasLimit!
    try {
      const estimation = await ethers.provider.estimateGas({
        to: userSA.address,
        data: userOp.callData,
        from: entryPoint.address,
      });
    } catch (error) {
      // console.log("revert reason ", error);
      errorInCallGasLimitEstimation = true;
    }

    expect(errorInCallGasLimitEstimation).to.equal(true);

    const userOpHash = await entryPoint.getUserOpHash(userOp);

    const iface = new ethers.utils.Interface([
      "error ModuleNotEnabled(address module)",
    ]); // Replace with the function signature
    const errorReason = iface.encodeErrorResult("ModuleNotEnabled", [
      delegateCallModule.address,
    ]);

    await expect(entryPoint.handleOps([userOp], bob.address))
      .to.emit(entryPoint, "UserOperationRevertReason")
      .withArgs(userOpHash, userOp.sender, userOp.nonce, errorReason)
      .to.emit(entryPoint, "UserOperationEvent");

    // No effects in balances
    expect(await mockToken.balanceOf(feeCollector)).to.equal(
      feeCollctorBalanceBefore.add(ethers.utils.parseEther("0"))
    );
  });

  it("does not function when called by EOA or other smart contract (module is enabled)", async () => {
    const {
      ecdsaRegistryModule,
      entryPoint,
      userSA,
      delegateCallModule,
      mockWrapper,
      mockToken,
    } = await setupTests();

    // simple execution module should have been enabled
    expect(await userSA.isModuleEnabled(delegateCallModule.address)).to.equal(
      true
    );

    // ecdsa module should have been enabled as default auth module
    expect(await userSA.isModuleEnabled(ecdsaRegistryModule.address)).to.equal(
      true
    );

    const feeCollctorBalanceBefore = await mockToken.balanceOf(feeCollector);

    // Making the transaction to directly call the module
    const wrapperCallData = mockWrapper.interface.encodeFunctionData(
      "interact",
      [mockToken.address, bob.address, ethers.utils.parseEther("30")]
    );

    // type Transaction without targetTxGas
    const transaction: any = {
      to: mockWrapper.address,
      value: "0",
      data: wrapperCallData,
      operation: 1, // dalegate call
    };

    await expect(
      delegateCallModule.connect(bob).execTransaction(transaction)
    ).to.be.revertedWith(""); // Review

    try {
      const estimation = await ethers.provider.estimateGas({
        to: delegateCallModule.address,
        data: (
          await delegateCallModule.populateTransaction.execTransaction(
            transaction
          )
        ).data,
        from: bob.address, // mock the call from some random EOA
      });
    } catch (error) {
      // Would be: Transaction reverted without a reason string
      // Making a call to EOA with payload of execTransactionFromModule
      // console.log("revert reason ", error);
    }

    // No effects in balances
    expect(await mockToken.balanceOf(feeCollector)).to.equal(
      feeCollctorBalanceBefore.add(ethers.utils.parseEther("0"))
    );
  });

  it("Fails to execute whole call if SA execute fails (module is enabled)", async () => {
    const {
      ecdsaRegistryModule,
      entryPoint,
      userSA,
      delegateCallModule,
      mockWrapper,
      mockToken,
    } = await setupTests();

    // simple execution module should have been enabled
    expect(await userSA.isModuleEnabled(delegateCallModule.address)).to.equal(
      true
    );

    // ecdsa module should have been enabled as default auth module
    expect(await userSA.isModuleEnabled(ecdsaRegistryModule.address)).to.equal(
      true
    );

    const feeCollctorBalanceBefore = await mockToken.balanceOf(feeCollector);

    const wrapperCallData = mockWrapper.interface.encodeFunctionData(
      "failToInteract",
      [mockToken.address, bob.address, ethers.utils.parseEther("30")]
    );

    // type Transaction without targetTxGas
    const transaction: any = {
      to: mockWrapper.address,
      value: "0",
      data: wrapperCallData,
      operation: 1, // dalegate call
    };

    // Calldata to send tokens using a wrapper
    const txnData1 = delegateCallModule.interface.encodeFunctionData(
      "execTransaction",
      [transaction]
    );

    const userOp = await makeEcdsaModuleUserOp(
      "execute_ncC",
      [delegateCallModule.address, 0, txnData1],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaRegistryModule.address,
      {
        preVerificationGas: 50000,
      }
    );

    const userOpHash = await entryPoint.getUserOpHash(userOp);

    let errorInModuleCall = false;

    const iface = new ethers.utils.Interface(["error ExecutionFailed()"]); // Replace with the function signature
    const errorReason = iface.encodeErrorResult("ExecutionFailed", []);

    // Module is enabled but internal tx fails from SA
    await expect(entryPoint.handleOps([userOp], bob.address))
      .to.emit(entryPoint, "UserOperationRevertReason")
      .withArgs(userOpHash, userOp.sender, userOp.nonce, errorReason)
      .to.emit(entryPoint, "UserOperationEvent");

    try {
      const estimation = await ethers.provider.estimateGas({
        to: delegateCallModule.address,
        data: (
          await delegateCallModule.populateTransaction.execTransaction(
            transaction
          )
        ).data,
        from: userSA.address, // mock the call to go from SA
      });
    } catch (error) {
      expect(error.reason).to.contain("ExecutionFailed");
      errorInModuleCall = true;
    }

    expect(errorInModuleCall).to.equal(true);

    // No effects in balances
    expect(await mockToken.balanceOf(feeCollector)).to.equal(
      feeCollctorBalanceBefore.add(ethers.utils.parseEther("0"))
    );
  });
});
