import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp } from "../utils/userOp";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  addLeavesForSmartAccountViaEcdsa,
} from "../utils/sessionKey";
import { encodeTransfer } from "../utils/testUtils";
import { hexZeroPad, hexConcat } from "ethers/lib/utils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import { keccak256 } from "ethereumjs-util";
import { MerkleTree } from "merkletreejs";

describe("SessionKey: SessionKey Manager Module", async () => {
  const [
    deployer,
    smartAccountOwner,
    alice,
    charlie,
    verifiedSigner,
    sessionKey,
    sessionKey2,
    fakeSessionKey,
  ] = waffle.provider.getWallets();

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

    const mockSessionValidationModule = await (
      await ethers.getContractFactory("MockSessionValidationModule")
    ).deploy();

    const validUntil = 0;
    const validAfter = 0;
    const sessionKeyData = hexZeroPad(sessionKey.address, 20);
    const leafData = hexConcat([
      hexZeroPad(ethers.utils.hexlify(validUntil), 6),
      hexZeroPad(ethers.utils.hexlify(validAfter), 6),
      hexZeroPad(mockSessionValidationModule.address, 20),
      sessionKeyData,
    ]);

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
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
      sessionKeyManager: sessionKeyManager,
      mockSessionValidationModule: mockSessionValidationModule,
      sessionKeyData: sessionKeyData,
      leafData: leafData,
      merkleTree: merkleTree,
    };
  });

  it("should be enabled", async () => {
    const { userSA, sessionKeyManager } = await setupTests();
    expect(await userSA.isModuleEnabled(sessionKeyManager.address)).to.equal(
      true
    );
  });

  describe("setMerkleRoot", async () => {
    it("MOVED: should add new session key by setting new merkle tree root", async () => {
      // moved to /test/bundler-integration/module/SessionKeyManager.Module.specs.ts
    });

    it("should add new session key to the existing merkle tree", async () => {
      const {
        userSA,
        sessionKeyManager,
        mockSessionValidationModule,
        entryPoint,
        ecdsaModule,
        mockToken,
      } = await setupTests();

      const leaf1Data = hexConcat([
        hexZeroPad("0x00", 6),
        hexZeroPad("0x00", 6),
        hexZeroPad(mockSessionValidationModule.address, 20),
        hexZeroPad(sessionKey.address, 20),
      ]);

      const merkleTree1 = await enableNewTreeForSmartAccountViaEcdsa(
        [ethers.utils.keccak256(leaf1Data)],
        sessionKeyManager,
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      expect(
        (await sessionKeyManager.getSessionKeys(userSA.address)).merkleRoot
      ).to.equal(merkleTree1.getHexRoot());

      const leaf2Data = hexConcat([
        hexZeroPad("0x00", 6),
        hexZeroPad("0x00", 6),
        hexZeroPad(mockSessionValidationModule.address, 20),
        hexZeroPad(sessionKey2.address, 20),
      ]);

      const merkleTree2 = await addLeavesForSmartAccountViaEcdsa(
        merkleTree1,
        [ethers.utils.keccak256(leaf2Data)],
        sessionKeyManager,
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      expect(
        (await sessionKeyManager.getSessionKeys(userSA.address)).merkleRoot
      ).to.equal(merkleTree2.getHexRoot());

      // now check the new session key can sign userOps
      const tokenAmountToTransfer = ethers.utils.parseEther("0.7734");
      const sessionKeyData2 = hexZeroPad(sessionKey2.address, 20);
      const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey2,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        mockSessionValidationModule.address,
        sessionKeyData2,
        merkleTree2.getHexProof(ethers.utils.keccak256(leaf2Data))
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      await entryPoint.handleOps([transferUserOp], alice.address, {
        gasLimit: 10000000,
      });
      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });
  });

  describe("validateUserOp", async () => {
    it("MOVED: should be able to process Session Key signed userOp via Mock session validation module", async () => {
      // moved to /test/bundler-integration/module/SessionKeyManager.Module.specs.ts
    });

    // reverts if signed with the session key that is not in the merkle tree
    // even if passing valid session key data (session key passed in sesson key data is actually the signer)
    it("should revert if signed with the session key that is not in the merkle tree", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        mockSessionValidationModule,
        mockToken,
        merkleTree,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");
      expect(
        (await sessionKeyManager.getSessionKeys(userSA.address)).merkleRoot
      ).to.equal(merkleTree.getHexRoot());

      const fakeSessionKeyData = hexZeroPad(fakeSessionKey.address, 20); // pass fakeSessionKey as a part of a session key data
      const fakeLeafData = hexConcat([
        hexZeroPad("0x00", 6), // validUntil
        hexZeroPad("0x00", 6), // validAfter
        hexZeroPad(mockSessionValidationModule.address, 20), // session validation module
        fakeSessionKeyData, // session key address and permissions
      ]);
      const fakeMerkleTree = new MerkleTree([fakeLeafData], keccak256, {
        sortPairs: false,
        hashLeaves: false,
      });

      const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        fakeSessionKey, // sign with fakeSessionKey
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        mockSessionValidationModule.address,
        fakeSessionKeyData,
        fakeMerkleTree.getHexProof(ethers.utils.keccak256(fakeLeafData)) // provide valid proof for fakeLeaf from fakeTree
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      await expect(
        entryPoint.handleOps([transferUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: SessionNotApproved");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("should revert with wrong validUntil", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        mockSessionValidationModule,
        mockToken,
        sessionKeyData,
        leafData,
        merkleTree,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const wrongValidUntil = 1;

      const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        wrongValidUntil,
        0,
        mockSessionValidationModule.address,
        sessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(leafData))
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      await expect(
        entryPoint.handleOps([transferUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: SessionNotApproved");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("should revert with wrong validAfter", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        mockSessionValidationModule,
        mockToken,
        sessionKeyData,
        leafData,
        merkleTree,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");
      const wrongValidAfter = 9999999999999;

      const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        wrongValidAfter,
        mockSessionValidationModule.address,
        sessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(leafData))
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      await expect(
        entryPoint.handleOps([transferUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: SessionNotApproved");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("should revert if session key is not yet valid", async () => {
      const {
        entryPoint,
        userSA,
        ecdsaModule,
        sessionKeyManager,
        mockSessionValidationModule,
        mockToken,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const sessionKeyData = hexZeroPad(sessionKey.address, 20);
      const currentTimestamp = (await ethers.provider.getBlock("latest"))
        .timestamp;
      const validAfter = currentTimestamp + 1000;
      const validUntil = validAfter + 1000;
      const leafData = hexConcat([
        hexZeroPad(ethers.utils.hexlify(validUntil), 6),
        hexZeroPad(ethers.utils.hexlify(validAfter), 6),
        hexZeroPad(mockSessionValidationModule.address, 20), // session validation module
        sessionKeyData, // session key address and permissions
      ]);
      const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
        [ethers.utils.keccak256(leafData)],
        sessionKeyManager,
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        validUntil,
        validAfter,
        mockSessionValidationModule.address,
        sessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(leafData))
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      await expect(
        entryPoint.handleOps([transferUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA22 expired or not due");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("should revert if session key is already expired", async () => {
      const {
        entryPoint,
        userSA,
        ecdsaModule,
        sessionKeyManager,
        mockSessionValidationModule,
        mockToken,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const sessionKeyData = hexZeroPad(sessionKey.address, 20);
      const currentTimestamp = (await ethers.provider.getBlock("latest"))
        .timestamp;
      const validUntil = currentTimestamp - 1000;
      const validAfter = validUntil - 1000;

      const leafData = hexConcat([
        hexZeroPad(ethers.utils.hexlify(validUntil), 6),
        hexZeroPad(ethers.utils.hexlify(validAfter), 6),
        hexZeroPad(mockSessionValidationModule.address, 20), // session validation module
        sessionKeyData, // session key address and permissions
      ]);
      const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
        [ethers.utils.keccak256(leafData)],
        sessionKeyManager,
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        validUntil,
        validAfter,
        mockSessionValidationModule.address,
        sessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(leafData))
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      await expect(
        entryPoint.handleOps([transferUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA22 expired or not due");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("should revert with wrong session validation module address", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        mockToken,
        leafData,
        sessionKeyData,
        merkleTree,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const wrongSessionValidationModule = await (
        await ethers.getContractFactory("ERC20SessionValidationModule")
      ).deploy();

      const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        wrongSessionValidationModule.address,
        sessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(leafData))
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      await expect(
        entryPoint.handleOps([transferUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: SessionNotApproved");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("should revert with wrong session key data", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        mockSessionValidationModule,
        mockToken,
        leafData,
        merkleTree,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const wrongSessionKeyData = hexZeroPad(sessionKey2.address, 20);

      const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        mockSessionValidationModule.address,
        wrongSessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(leafData))
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      await expect(
        entryPoint.handleOps([transferUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: SessionNotApproved");
      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });
  });

  describe("isValidSignature", async () => {
    it("should return 0xffffffff even for the valid hash/signature pair", async () => {
      const { sessionKeyManager } = await setupTests();
      const message = "Some message from dApp";
      const signature = await smartAccountOwner.signMessage(message);
      const messageHash = ethers.utils.hashMessage(message);
      const notMagicValue = "0xffffffff";
      expect(
        await sessionKeyManager.isValidSignature(messageHash, signature)
      ).to.be.equal(notMagicValue);
    });
  });
});
