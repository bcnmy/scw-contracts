import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import {
  makeEcdsaModuleUserOp,
  fillAndSign,
  makeMultichainEcdsaModuleUserOp,
} from "../utils/userOp";
import { getERC20SessionKeyParams } from "../utils/sessionKey";
import { encodeTransfer } from "../utils/testUtils";
import { defaultAbiCoder, hexZeroPad, hexConcat } from "ethers/lib/utils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import { keccak256 } from "ethereumjs-util";
import { MerkleTree } from "merkletreejs";

/**
 * @note Those tests do not actually process the userOp on several chains, instead they showcase
 * that one of the userOps included in the tree, which root is signed by user, can be processed
 * on the corresponding chain. Assuming, this will be valid for any userOp from the tree,
 * this approach can be considered representative enough for testing purposes.
 * The actual multichain tests based on Foundry framework can be added later
 */
describe("MultichainValidator Module", async () => {
  const [
    deployer,
    smartAccountOwner,
    alice,
    charlie,
    verifiedSigner,
    sessionKey,
  ] = waffle.provider.getWallets();
  const maxAmount = ethers.utils.parseEther("100");

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    // deploy a smart account with a multichain module and enable the session key manager
    // and a session key all in one userOp
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const smartAccountFactory = await getSmartAccountFactory();
    const mockToken = await getMockToken();
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();

    const MultichainECDSAValidator = await ethers.getContractFactory(
      "MultichainECDSAValidator"
    );
    const multichainECDSAValidator = await MultichainECDSAValidator.deploy();
    const sessionKeyManager = await (
      await ethers.getContractFactory("SessionKeyManager")
    ).deploy();
    const erc20SessionModule = await (
      await ethers.getContractFactory("ERC20SessionValidationModule")
    ).deploy();

    const SmartAccountFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    // ============ preparing smart account deployment =============

    // Data required to initialize the ecdsa ownership in the multichain module
    const ecdsaOwnershipSetupData =
      MultichainECDSAValidator.interface.encodeFunctionData(
        "initForSmartAccount",
        [smartAccountOwner.address]
      );
    const smartAccountDeploymentIndex = 0;

    // Data required to deploy the smart account
    // Will be packed into userOp.initcode
    const deploymentData = SmartAccountFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [
        multichainECDSAValidator.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex,
      ]
    );

    // Calculating the expected smart account address
    const expectedSmartAccountAddress =
      await smartAccountFactory.getAddressForCounterFactualAccount(
        multichainECDSAValidator.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

    // Fund the account
    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(
      expectedSmartAccountAddress,
      ethers.utils.parseEther("1000000")
    );
    await mockToken.mint(charlie.address, ethers.utils.parseEther("10"));

    // ============== session key setup =============

    // Get Session Key Params
    const { leafData } = await getERC20SessionKeyParams(
      sessionKey.address,
      mockToken.address,
      charlie.address,
      maxAmount,
      0,
      0,
      erc20SessionModule.address
    );

    // Build a Merkle Tree with the session key data
    const sessionKeyMerkleTree = new MerkleTree(
      [ethers.utils.keccak256(leafData)],
      keccak256,
      { sortPairs: true, hashLeaves: false }
    );

    // Calldata to enable the session key manager module
    const enableSessionKeyManagerData =
      SmartAccount.interface.encodeFunctionData("enableModule", [
        sessionKeyManager.address,
      ]);

    // Calldata to set the merkle root in the session key manager
    const enableSessionKeyData = sessionKeyManager.interface.encodeFunctionData(
      "setMerkleRoot",
      [sessionKeyMerkleTree.getHexRoot()]
    );

    // ============== make userOp ===============

    // Batched calldata to enable the session key manager and set the merkle root
    const batchUserOpCallData = SmartAccount.interface.encodeFunctionData(
      "executeBatch_y6U",
      [
        [expectedSmartAccountAddress, sessionKeyManager.address],
        [0, 0],
        [enableSessionKeyManagerData, enableSessionKeyData],
      ]
    );

    // make a userOp to deploy the smart account and enable the session key manager and session key
    const deploymentUserOp = await fillAndSign(
      {
        sender: expectedSmartAccountAddress,
        callGasLimit: 1_000_000,
        initCode: ethers.utils.hexConcat([
          smartAccountFactory.address,
          deploymentData,
        ]),
        callData: batchUserOpCallData,
      },
      smartAccountOwner,
      entryPoint,
      "nonce",
      true
    );

    // =============== make a multichain signature for a userOp ===============

    const validUntil = 0; // unlimited
    const validAfter = 0;

    // Some random hash.
    // In the wild every leaf should be valid sum of validUntil, validAfter and userOpHash
    const leaf1 = "0xb0bb0b";
    // This is the actual leaf: validUntil+validAfter+userOpHash
    const leaf2 = hexConcat([
      hexZeroPad(ethers.utils.hexlify(validUntil), 6),
      hexZeroPad(ethers.utils.hexlify(validAfter), 6),
      hexZeroPad(await entryPoint.getUserOpHash(deploymentUserOp), 32),
    ]);
    const leaf3 = "0xdecafdecaf"; // Some random hash.
    const leaf4 = "0xa11cea11ce"; // Some random hash.

    // prepare the merkle tree containing the leaves with chainId info
    const leaves = [leaf1, leaf2, leaf3, leaf4].map((x) =>
      ethers.utils.keccak256(x)
    );
    const chainMerkleTree = new MerkleTree(leaves, keccak256, {
      sortPairs: true,
    });
    const merkleProof = chainMerkleTree.getHexProof(leaves[1]);

    // sign the merkle root with the smart account owner
    const multichainSignature = await smartAccountOwner.signMessage(
      ethers.utils.arrayify(chainMerkleTree.getHexRoot())
    );

    // encode the signature into a module signature
    const moduleSignature = defaultAbiCoder.encode(
      ["uint48", "uint48", "bytes32", "bytes32[]", "bytes"],
      [
        validUntil,
        validAfter,
        chainMerkleTree.getHexRoot(),
        merkleProof,
        multichainSignature,
      ]
    );

    // add validator module address to the signature
    const signatureWithModuleAddress = defaultAbiCoder.encode(
      ["bytes", "address"],
      [moduleSignature, multichainECDSAValidator.address]
    );

    // =================== put signature into userOp and execute ===================
    deploymentUserOp.signature = signatureWithModuleAddress;
    const handleOpsTxn = await entryPoint.handleOps(
      [deploymentUserOp],
      alice.address,
      { gasLimit: 10000000 }
    );
    const receipt = await handleOpsTxn.wait();
    console.log(
      "Deploy with a multichain signature + enable Session key gas used: ",
      receipt.gasUsed.toString()
    );

    // =================== connect SA and return everything ====================
    const userSA = await ethers.getContractAt(
      "SmartAccount",
      expectedSmartAccountAddress
    );

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: smartAccountFactory,
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
      multichainECDSAValidator: multichainECDSAValidator,
      sessionKeyManager: sessionKeyManager,
      sessionKeyMerkleTree: sessionKeyMerkleTree,
    };
  });

  it("modules and the session key should be enabled", async () => {
    const {
      userSA,
      multichainECDSAValidator,
      sessionKeyManager,
      sessionKeyMerkleTree,
    } = await setupTests();
    expect(
      await userSA.isModuleEnabled(multichainECDSAValidator.address)
    ).to.equal(true);
    expect(await userSA.isModuleEnabled(sessionKeyManager.address)).to.equal(
      true
    );
    expect(
      (await sessionKeyManager.getSessionKeys(userSA.address)).merkleRoot
    ).to.equal(sessionKeyMerkleTree.getHexRoot());
  });

  describe("Multichain userOp validation", async () => {
    it("MOVED: should process a userOp with a multichain signature", async () => {
      // moved to test/bundler-integration/module/MultichainValidator.test.specs.ts
    });

    it("should not process an expired userOp", async () => {
      const { userSA, entryPoint, multichainECDSAValidator, mockToken } =
        await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5945");

      const validUntil = 1; // less than block.timestamp and not 0 as 0 means unlimited
      const validAfter = 0;

      // make a userOp to send tokens to charlie which is expired
      const sendTokenMultichainUserOp = await makeMultichainEcdsaModuleUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        ["0xb0bb0b", "0xdecaf0"],
        {},
        validUntil,
        validAfter
      );

      await expect(
        entryPoint.handleOps([sendTokenMultichainUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA22 expired or not due");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("should not process a not due userOp", async () => {
      const { userSA, entryPoint, multichainECDSAValidator, mockToken } =
        await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5945");

      const validUntil = 0;
      const validAfter = 32490999253; // year 2999, not due yet

      // make a userOp to send tokens to charlie which is not due yet
      const sendTokenMultichainUserOp = await makeMultichainEcdsaModuleUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        ["0xb0bb0b", "0xdecaf0"],
        {},
        validUntil,
        validAfter
      );

      await expect(
        entryPoint.handleOps([sendTokenMultichainUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA22 expired or not due");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("should not allow to replay a userOp with the same nonce", async () => {
      const { userSA, entryPoint, multichainECDSAValidator, mockToken } =
        await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.591145");

      const sendTokenMultichainUserOp = await makeMultichainEcdsaModuleUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        ["0xb0bb0b", "0xdecaf0"]
      );

      const handleOpsTxn = await entryPoint.handleOps(
        [sendTokenMultichainUserOp],
        alice.address,
        { gasLimit: 10000000 }
      );
      await handleOpsTxn.wait();

      const charlieTokenBalanceAfterFirstUserOp = await mockToken.balanceOf(
        charlie.address
      );
      expect(charlieTokenBalanceAfterFirstUserOp).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );

      // other userOp, but with the same nonce encoded into merkle tree and signed
      // it has correct userOp.nonce field
      const sendTokenMultichainUserOp2 = await makeMultichainEcdsaModuleUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        ["0xb0bb0b", "0xdecaf0"]
      );

      sendTokenMultichainUserOp2.nonce = sendTokenMultichainUserOp.nonce;

      await expect(
        entryPoint.handleOps([sendTokenMultichainUserOp2], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: Invalid UserOp");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceAfterFirstUserOp
      );
    });

    it("should not process a userOp if the merkle root provided was not signed", async () => {
      const { userSA, entryPoint, multichainECDSAValidator, mockToken } =
        await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.591145");

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      // make calldata for a userOp to send tokens to charlie
      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ]
      );

      // fill user op
      const userOp = await fillAndSign(
        {
          sender: userSA.address,
          callData: txnDataAA1,
        },
        smartAccountOwner,
        entryPoint,
        "nonce",
        true
      );

      const validUntil = 0;
      const validAfter = 0;

      // make a tree of some random leaves and a leaf of the userOp
      let leaves = ["0xa11ce0", "0xbeef"];
      const leafOfThisUserOp = hexConcat([
        hexZeroPad(ethers.utils.hexlify(validUntil), 6),
        hexZeroPad(ethers.utils.hexlify(validAfter), 6),
        hexZeroPad(await entryPoint.getUserOpHash(userOp), 32),
      ]);
      leaves.push(leafOfThisUserOp);
      leaves = leaves.map((x) => ethers.utils.keccak256(x));
      const correctMerkleTree = new MerkleTree(leaves, keccak256, {
        sortPairs: true,
      });

      // make a wrong merkle tree
      const wrongMerkleTree = new MerkleTree(
        ["0xb0bb0b", "0xdecaf0"].map((x) => ethers.utils.keccak256(x)),
        keccak256,
        { sortPairs: true }
      );

      const wrongSignature = await smartAccountOwner.signMessage(
        ethers.utils.arrayify(wrongMerkleTree.getHexRoot())
      );

      const merkleProof = correctMerkleTree.getHexProof(
        leaves[leaves.length - 1]
      );

      // here we provide root and proof from the correct tree, but signature is over
      // another tree root
      const moduleSignature = defaultAbiCoder.encode(
        ["uint48", "uint48", "bytes32", "bytes32[]", "bytes"],
        [
          validUntil,
          validAfter,
          correctMerkleTree.getHexRoot(),
          merkleProof,
          wrongSignature,
        ]
      );

      // add validator module address to the signature
      const signatureWithModuleAddress = defaultAbiCoder.encode(
        ["bytes", "address"],
        [moduleSignature, multichainECDSAValidator.address]
      );
      userOp.signature = signatureWithModuleAddress;

      // thus we expect userOp to not be validated
      await expect(
        entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA24 signature error");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("should not process a userOp with a wrong proof provided", async () => {
      const { userSA, entryPoint, multichainECDSAValidator, mockToken } =
        await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.591145");

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ]
      );

      const userOp = await fillAndSign(
        {
          sender: userSA.address,
          callData: txnDataAA1,
        },
        smartAccountOwner,
        entryPoint,
        "nonce",
        true
      );

      const validUntil = 0;
      const validAfter = 0;

      let leaves = ["0xa11ce0", "0xbeef"];
      const leafOfThisUserOp = hexConcat([
        hexZeroPad(ethers.utils.hexlify(validUntil), 6),
        hexZeroPad(ethers.utils.hexlify(validAfter), 6),
        hexZeroPad(await entryPoint.getUserOpHash(userOp), 32),
      ]);
      leaves.push(leafOfThisUserOp);
      leaves = leaves.map((x) => ethers.utils.keccak256(x));

      const correctMerkleTree = new MerkleTree(leaves, keccak256, {
        sortPairs: true,
      });

      const signature = await smartAccountOwner.signMessage(
        ethers.utils.arrayify(correctMerkleTree.getHexRoot())
      );

      const wrongLeaf = ethers.utils.keccak256("0xa11ce0");
      const wrongProof = correctMerkleTree.getHexProof(wrongLeaf);
      const moduleSignature = defaultAbiCoder.encode(
        ["uint48", "uint48", "bytes32", "bytes32[]", "bytes"],
        [
          validUntil,
          validAfter,
          correctMerkleTree.getHexRoot(),
          wrongProof,
          signature,
        ]
      );

      // add validator module address to the signature
      const signatureWithModuleAddress = defaultAbiCoder.encode(
        ["bytes", "address"],
        [moduleSignature, multichainECDSAValidator.address]
      );

      userOp.signature = signatureWithModuleAddress;

      await expect(
        entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: Invalid UserOp");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });
  });

  describe("Single chain userOp validation", async () => {
    it("MOVED: should process a userOp with a regular ECDSA single chain signature", async () => {
      // moved to test/bundler-integration/module/MultichainValidator.test.specs.ts
    });

    it("should not process a userOp with a regular ECDSA single chain signature by the non-authorized signer", async () => {
      const { entryPoint, mockToken, userSA, multichainECDSAValidator } =
        await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

      const notOwner = alice;

      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        notOwner,
        entryPoint,
        multichainECDSAValidator.address
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA24 signature error");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });
  });
});
