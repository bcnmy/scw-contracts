import { expect } from "chai";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  getERC20SessionKeyParams,
} from "../../utils/sessionKey";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp } from "../../utils/userOp";
import { encodeTransfer } from "../../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import { BigNumber } from "ethers";
import { UserOperation } from "../../utils/userOperation";

describe("SessionKey: ERC20 Session Validation Module", async () => {
  const [
    deployer,
    smartAccountOwner,
    alice,
    bob,
    charlie,
    verifiedSigner,
    refundReceiver,
    sessionKey,
    nonAuthSessionKey,
  ] = waffle.provider.getWallets();
  const maxAmount = ethers.utils.parseEther("100");

  const setupTests = deployments.createFixture(
    async ({ deployments, getNamedAccounts }) => {
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

      const erc20SessionModule = await (
        await ethers.getContractFactory("ERC20SessionValidationModule")
      ).deploy();

      const { sessionKeyData, leafData } = await getERC20SessionKeyParams(
        sessionKey.address,
        mockToken.address,
        charlie.address,
        maxAmount,
        0,
        0,
        erc20SessionModule.address
      );

      const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
        [ethers.utils.keccak256(leafData)],
        sessionKeyManager,
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      return {
        entryPoint: entryPoint,
        smartAccountImplementation: await getSmartAccountImplementation(),
        smartAccountFactory: await getSmartAccountFactory(),
        ecdsaModule: ecdsaModule,
        userSA: userSA,
        mockToken: mockToken,
        verifyingPaymaster: await getVerifyingPaymaster(
          deployer,
          verifiedSigner
        ),
        sessionKeyManager: sessionKeyManager,
        erc20SessionModule: erc20SessionModule,
        sessionKeyData: sessionKeyData,
        leafData: leafData,
        merkleTree: merkleTree,
      };
    }
  );

  const makeErc20TransferUserOp = async function (
    token: string,
    amount: BigNumber,
    recipient: string,
    txnValue: BigNumber,
    testParams: any = {}
  ): Promise<UserOperation> {
    const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
      "executeCall",
      [token, txnValue, encodeTransfer(recipient, amount.toString())],
      testParams.userSA.address,
      sessionKey,
      testParams.entryPoint,
      testParams.sessionKeyManager.address,
      0,
      0,
      testParams.erc20SessionModule.address,
      testParams.sessionKeyData,
      testParams.merkleTree.getHexProof(
        ethers.utils.keccak256(testParams.leafData)
      )
    );
    return transferUserOp;
  };

  it("MOVED: should be able to process Session Key signed userOp", async () => {
    // moved to /test/bundler-integration/module/SessionValidationModules/ERC20SessionValidation.Module.specs.ts
  });

  it("should revert when userOp is for an invalid token", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      merkleTree,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");

    const mockToken2 = await (
      await ethers.getContractFactory("MockToken")
    ).deploy();
    await mockToken2.mint(userSA.address, ethers.utils.parseEther("1000000"));

    const charlieToken2BalanceBefore = await mockToken2.balanceOf(
      charlie.address
    );
    const transferUserOp = await makeErc20TransferUserOp(
      mockToken2.address,
      tokenAmountToTransfer,
      charlie.address,
      ethers.utils.parseEther("0"),
      {
        entryPoint,
        userSA,
        sessionKeyManager,
        erc20SessionModule,
        sessionKeyData,
        leafData,
        merkleTree,
      }
    );
    await expect(
      entryPoint.handleOps([transferUserOp], alice.address, {
        gasLimit: 10000000,
      })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: ERC20SV Wrong Token");
    expect(await mockToken2.balanceOf(charlie.address)).to.equal(
      charlieToken2BalanceBefore
    );
  });

  it("should revert if userOp calldata involves sending value", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      mockToken,
      sessionKeyData,
      leafData,
      merkleTree,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const transferUserOp = await makeErc20TransferUserOp(
      mockToken.address,
      tokenAmountToTransfer,
      charlie.address,
      ethers.utils.parseEther("0.132323"),
      {
        entryPoint,
        userSA,
        sessionKeyManager,
        erc20SessionModule,
        sessionKeyData,
        leafData,
        merkleTree,
      }
    );
    await expect(
      entryPoint.handleOps([transferUserOp], alice.address, {
        gasLimit: 10000000,
      })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: ERC20SV Non Zero Value");
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore
    );
  });

  it("should revert if userOp is for wrong recipient", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      mockToken,
      sessionKeyData,
      leafData,
      merkleTree,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");

    const wrongRecipient = bob.address;
    const wrongRecipientTokenBalanceBefore = await mockToken.balanceOf(
      wrongRecipient
    );
    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const transferUserOp = await makeErc20TransferUserOp(
      mockToken.address,
      tokenAmountToTransfer,
      wrongRecipient,
      ethers.utils.parseEther("0"),
      {
        entryPoint,
        userSA,
        sessionKeyManager,
        erc20SessionModule,
        sessionKeyData,
        leafData,
        merkleTree,
      }
    );
    await expect(
      entryPoint.handleOps([transferUserOp], alice.address, {
        gasLimit: 10000000,
      })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: ERC20SV Wrong Recipient");
    expect(await mockToken.balanceOf(wrongRecipient)).to.equal(
      wrongRecipientTokenBalanceBefore
    );
  });

  it("should revert if userOp is for too large amount", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      mockToken,
      sessionKeyData,
      leafData,
      merkleTree,
    } = await setupTests();
    const tooLargeAmount = maxAmount.add(ethers.utils.parseEther("1"));

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const transferUserOp = await makeErc20TransferUserOp(
      mockToken.address,
      tooLargeAmount,
      charlie.address,
      ethers.utils.parseEther("0"),
      {
        entryPoint,
        userSA,
        sessionKeyManager,
        erc20SessionModule,
        sessionKeyData,
        leafData,
        merkleTree,
      }
    );
    await expect(
      entryPoint.handleOps([transferUserOp], alice.address, {
        gasLimit: 10000000,
      })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: ERC20SV Max Amount Exceeded");
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore
    );
  });

  it("should revert if userOp is signed by non session key", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      mockToken,
      sessionKeyData,
      leafData,
      merkleTree,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );

    const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
      "executeCall",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      nonAuthSessionKey, // sign userOp with non-authorized session key
      entryPoint,
      sessionKeyManager.address,
      0,
      0,
      erc20SessionModule.address,
      sessionKeyData,
      merkleTree.getHexProof(ethers.utils.keccak256(leafData))
    );

    await expect(
      entryPoint.handleOps([transferUserOp], alice.address, {
        gasLimit: 10000000,
      })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA24 signature error");
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore
    );
  });
});
