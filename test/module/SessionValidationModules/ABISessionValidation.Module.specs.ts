import { expect } from "chai";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  getERC20SessionKeyParams,
  getABISessionKeyParams,
  addLeavesForSmartAccountViaEcdsa,
} from "../../utils/sessionKey";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../../utils/userOp";
import { encodeTransfer } from "../../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../../utils/setupHelper";
import { BigNumber } from "ethers";
import { UserOperation } from "../../utils/userOperation";

describe("SessionKey: ABI Session Validation Module", async () => {
  const [
    deployer,
    smartAccountOwner,
    alice,
    bob,
    charlie,
    verifiedSigner,
    sessionKey,
    nonAuthSessionKey,
  ] = waffle.provider.getWallets();
  const maxAmount = ethers.utils.parseEther("100");

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();
    const mockToken = await getMockToken();
    const entryPoint = await getEntryPoint();
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
    const sessionKeyManager = await (
      await ethers.getContractFactory("SessionKeyManager")
    ).deploy();
    const userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [sessionKeyManager.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    await entryPoint.handleOps([userOp], alice.address);

    const abiSVM = await (
      await ethers.getContractFactory("ABISessionValidationModule")
    ).deploy();

    const { sessionKeyData, leafData } = await getABISessionKeyParams(
      sessionKey.address,
      [
        mockToken.address,
        ethers.utils.hexDataSlice(
          ethers.utils.id("transfer(address,uint256)"),
          0,
          4
        ), // transfer function selector
        ethers.utils.parseEther("1"),
        // array of offsets, values, and conditions
        [
          [0, ethers.utils.hexZeroPad(charlie.address, 32), 0], // equal
          [32, ethers.utils.hexZeroPad("0x056bc75e2d63100000", 32), 1], // less than or equal
        ],
      ],
      0,
      0,
      abiSVM.address
    );

    const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
      [ethers.utils.keccak256(leafData)],
      sessionKeyManager,
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );

    const vulnerableErc20SessionModule = await (
      await ethers.getContractFactory("VulnerableERC20SessionValidationModule")
    ).deploy();

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      mockToken: mockToken,
      sessionKeyManager: sessionKeyManager,
      abiSVM: abiSVM,
      sessionKeyData: sessionKeyData,
      leafData: leafData,
      merkleTree: merkleTree,
      vulnerableErc20SessionModule: vulnerableErc20SessionModule,
      sessionKey: sessionKey,
    };
  });

  const makeErc20TransferUserOp = async function (
    token: string,
    amount: BigNumber,
    recipient: string,
    txnValue: BigNumber,
    testParams: any = {}
  ): Promise<UserOperation> {
    const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
      "execute_ncC",
      [token, txnValue, encodeTransfer(recipient, amount.toString())],
      testParams.userSA.address,
      sessionKey,
      testParams.entryPoint,
      testParams.sessionKeyManager.address,
      0,
      0,
      testParams.abiSVM.address,
      testParams.sessionKeyData,
      testParams.merkleTree.getHexProof(
        ethers.utils.keccak256(testParams.leafData)
      )
    );
    return transferUserOp;
  };

  it("Should be able to process Session Key signed userOp", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      abiSVM,
      sessionKeyData,
      leafData,
      merkleTree,
      mockToken,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");

    const transferUserOp = await makeErc20TransferUserOp(
      mockToken.address,
      tokenAmountToTransfer,
      charlie.address,
      ethers.utils.parseEther("0"),
      {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyData,
        leafData,
        merkleTree,
      }
    );

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );

    const tx = await entryPoint.handleOps([transferUserOp], alice.address, {
      gasLimit: 10000000,
    });

    const receipt = await tx.wait();
    //log gas usage
    console.log(
      `Gas used for Session Key signed userOp: ${receipt.gasUsed.toString()}`
    );

    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });
});
