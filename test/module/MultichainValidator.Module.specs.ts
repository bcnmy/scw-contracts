import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import {BigNumber} from "ethers";
import { makeEcdsaModuleUserOp, fillAndSign, makeMultichainEcdsaModuleUserOp } from "../utils/userOp";
import { getERC20SessionKeyParams } from "../utils/sessionKey";
import { encodeTransfer } from "../utils/testUtils";
import { hexZeroPad, hexConcat, defaultAbiCoder } from "ethers/lib/utils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../utils/setupHelper";
import {keccak256} from "ethereumjs-util";
import { MerkleTree } from "merkletreejs";
import { provider } from "ganache";
import { MultichainECDSAValidator, SessionKeyManager, SmartAccount } from "../../typechain";

describe("MultichainValidator Module", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner, refundReceiver, sessionKey, wrongMultichainModule] = waffle.provider.getWallets();
  const maxAmount = ethers.utils.parseEther("100");

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {

    // deploy a smart account with a multichain module and enable the session key manager
    // and a session key all in one userOp
    
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const smartAccountFactory = await getSmartAccountFactory();
    const mockToken = await getMockToken();
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    
    const MultichainECDSAValidator = await ethers.getContractFactory("MultichainECDSAValidator");
    const multichainECDSAValidator = await MultichainECDSAValidator.deploy();
    const sessionKeyManager = await (await ethers.getContractFactory("SessionKeyManager")).deploy();
    const erc20SessionModule = await (await ethers.getContractFactory("ERC20SessionValidationModule")).deploy();
    
    const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");
    
    // ============ preparing smart account deployment =============

    let ecdsaOwnershipSetupData = MultichainECDSAValidator.interface.encodeFunctionData(
      "initForSmartAccount",
      [smartAccountOwner.address]
    );
    const smartAccountDeploymentIndex = 0;
    
    const deploymentData = SmartAccountFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [multichainECDSAValidator.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex]
    );

    const expectedSmartAccountAddress =
      await smartAccountFactory.getAddressForCounterFactualAccount(
        multichainECDSAValidator.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

    // funding account
    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(expectedSmartAccountAddress, ethers.utils.parseEther("1000000"));

    // ============== session key setup =============

    const {sessionKeyData, leafData} = await getERC20SessionKeyParams(
      sessionKey.address,
      mockToken.address,
      charlie.address,
      maxAmount,
      0,
      0,
      erc20SessionModule.address
    );

    const sessionKeyMerkleTree = new MerkleTree(
      [ethers.utils.keccak256(leafData)],
      keccak256,
      { sortPairs: true, hashLeaves: false }
    );

    const enableSessionKeyManagerData = SmartAccount.interface.encodeFunctionData(
      "enableModule",
      [sessionKeyManager.address]
    );

    const enableSessionKeyData = sessionKeyManager.interface.encodeFunctionData(
      "setMerkleRoot",
      [sessionKeyMerkleTree.getHexRoot()]
    );

    // ============== make userOp ===============

    const batchUserOpCallData = SmartAccount.interface.encodeFunctionData(
      "executeBatchCall_4by",
      [
        [expectedSmartAccountAddress, sessionKeyManager.address],
        [0, 0],
        [enableSessionKeyManagerData, enableSessionKeyData],
      ]
    );

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
      "nonce"
    );
    
    // =============== make a multichain signature for a userOp ===============
    
    const leaf1 = ethers.utils.keccak256('0xb0bb0b');
    const leaf2 = await entryPoint.getUserOpHash(deploymentUserOp);
    const leaf3 = ethers.utils.keccak256('0xdecafdecaf');
    const leaf4 = ethers.utils.keccak256('0xa11cea11ce');

    // prepare the merkle tree containing the leaves with chainId info
    const leaves = [leaf1, leaf2, leaf3, leaf4];
    const chainMerkleTree = new MerkleTree(
      leaves,
      keccak256,
      { sortPairs: true }
    );
    const merkleProof = chainMerkleTree.getHexProof(leaves[1]);

    const multichainSignature = await smartAccountOwner.signMessage(ethers.utils.arrayify(chainMerkleTree.getHexRoot()));

    const moduleSignature = defaultAbiCoder.encode(
      ["bytes32", "bytes32[]", "bytes"],
      [
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
    const handleOpsTxn = await entryPoint.handleOps([deploymentUserOp], alice.address, {gasLimit: 10000000});
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

  it ("modules and the session key should be enabled", async () => {
    const { userSA, multichainECDSAValidator, sessionKeyManager, sessionKeyMerkleTree} = await setupTests();
    expect(await userSA.isModuleEnabled(multichainECDSAValidator.address)).to.equal(true);
    expect(await userSA.isModuleEnabled(sessionKeyManager.address)).to.equal(true);
    expect(
      (await sessionKeyManager.getSessionKeys(userSA.address)).merkleRoot
    ).to.equal(sessionKeyMerkleTree.getHexRoot());
  });

  
  describe ("Multichain userOp validation", async () => {

    it ("should process a userOp with a multichain signature", async () => {
      const { userSA, entryPoint, multichainECDSAValidator, mockToken} = await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5945");

      const chainId = 31337;
      const leaveId = 0; //index of the leave (chainId) that we are making the userOp for
      const sendTokenMultichainUserOp = await makeMultichainEcdsaModuleUserOp(
        "executeCall_s1m",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        [],
      );

      const handleOpsTxn = await entryPoint.handleOps([sendTokenMultichainUserOp], alice.address, {gasLimit: 10000000});
      const receipt = await handleOpsTxn.wait();
      console.log(
        "Send erc20 with multichain signature on single chain: ",
        receipt.gasUsed.toString()
      );

      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
    });

/*
    it ("should not allow to replay a userOp with the same nonce", async () => {

      const { userSA, entryPoint, multichainECDSAValidator, mockToken} = await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.591145");

      const chainId = 31337;
      const nonce = await multichainECDSAValidator.getNonce(userSA.address);
      const leaveId = 0; //index of the leave (chainId) that we are making the userOp for
      const sendTokenMultichainUserOp = await makeMultichainEcdsaModuleUserOp(
        "executeCall_s1m",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        [chainId],
        [nonce],
        [multichainECDSAValidator.address],
        leaveId
      );

      const handleOpsTxn = await entryPoint.handleOps([sendTokenMultichainUserOp], alice.address, {gasLimit: 10000000});
      await handleOpsTxn.wait();

      const charlieTokenBalanceAfterFirstUserOp = await mockToken.balanceOf(charlie.address);
      expect(charlieTokenBalanceAfterFirstUserOp).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));

      //other userOp, but with the same nonce encoded into merkle tree and signed
      //it has correct userOp.nonce field
      const sendTokenMultichainUserOp2 = await makeMultichainEcdsaModuleUserOp(
        "executeCall_s1m",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        [chainId],
        [nonce],
        [multichainECDSAValidator.address],
        leaveId
      );

      await expect(
        entryPoint.handleOps([sendTokenMultichainUserOp2], alice.address, {gasLimit: 10000000})
      ).to.be.revertedWith("FailedOp").withArgs(0, "AA23 reverted: Invalid Chain Params");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceAfterFirstUserOp);
      
    });

    it ("should not process a userOp on a non-authorized chainId", async () => {
      const { userSA, entryPoint, multichainECDSAValidator, mockToken} = await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.695");

      const correctChainId = 31337;
      const wrongChainId = 555;
      const leaveId = 0;
      const nonce = await multichainECDSAValidator.getNonce(userSA.address);

      const sendTokenMultichainUserOp2 = await makeMultichainEcdsaModuleUserOp(
        "executeCall_s1m",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        [wrongChainId],
        [nonce],
        [multichainECDSAValidator.address],
        leaveId
      );

      await expect(
        entryPoint.handleOps([sendTokenMultichainUserOp2], alice.address, {gasLimit: 10000000})
      ).to.be.revertedWith("FailedOp").withArgs(0, "AA23 reverted: Invalid Chain Params");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore);
    });

    it ("should not process a userOp on a non-authorized module", async () => {
      const { userSA, entryPoint, multichainECDSAValidator, mockToken} = await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.591145");

      const chainId = 31337;
      const leaveId = 0;
      const nonce = await multichainECDSAValidator.getNonce(userSA.address);

      const sendTokenMultichainUserOp2 = await makeMultichainEcdsaModuleUserOp(
        "executeCall_s1m",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        [chainId],
        [nonce],
        [wrongMultichainModule.address],
        leaveId
      );

      await expect(
        entryPoint.handleOps([sendTokenMultichainUserOp2], alice.address, {gasLimit: 10000000})
      ).to.be.revertedWith("FailedOp").withArgs(0, "AA23 reverted: Invalid Chain Params");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore);
    
    });

    it ("should not process a userOp if the merkle root provided was not signed", async () => {
      // scenario is the following: we get the correct userOp from some chain, but we change the merkle root and proof to the one 
      // that contains valid leaf for some other chain and trying to use it on this another chain

      const { userSA, entryPoint, multichainECDSAValidator, mockToken} = await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.591145");

      const userOp = await fillAndSign(
        {
          sender: userSA.address,
          callData: userSA.interface.encodeFunctionData(
            "executeCall_s1m",
            [
              mockToken.address,
              ethers.utils.parseEther("0"),
              encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
            ]
          ),
        },
        smartAccountOwner,
        entryPoint,
        'nonce'
      );
    
      const chainLeafData1 = hexConcat([
        hexZeroPad(BigNumber.from(18888).toHexString(), 32), // random chainId
        hexZeroPad(BigNumber.from(1).toHexString(), 32), //nonce
        hexZeroPad(multichainECDSAValidator.address,20),
      ]);
      
      const chainMerkleTree = new MerkleTree(
        [ethers.utils.keccak256(chainLeafData1)],
        keccak256,
        { sortPairs: true }
      );
    
      // prepare the multichain hash
      const hash = ethers.utils.keccak256(
        hexConcat([
          await multichainECDSAValidator.getChainAgnosticUserOpHash(userOp),
          chainMerkleTree.getHexRoot(),
        ])
      );
      const multichainSignature = await smartAccountOwner.signMessage(ethers.utils.arrayify(hash));

      // ============== provide another merkle root in params ================
      // legit params
      const chainId = 31337;
      const nonce = await multichainECDSAValidator.getNonce(userSA.address);

      const chainLeafData3 = hexConcat([
        hexZeroPad(BigNumber.from(chainId).toHexString(), 32), // random chainId
        hexZeroPad(BigNumber.from(nonce).toHexString(), 32), //nonce
        hexZeroPad(multichainECDSAValidator.address,20),
      ]);
  
      const chainLeafData4 = hexConcat([
        hexZeroPad(BigNumber.from(4129).toHexString(), 32), // random chainId
        hexZeroPad(BigNumber.from(0).toHexString(), 32), //nonce
        hexZeroPad(multichainECDSAValidator.address,20),
      ]);
  
      // prepare the merkle tree containing the leaves with chainId info
      const leaves = [chainLeafData3, chainLeafData4].map(value => ethers.utils.keccak256(value));
      const chainMerkleTree2 = new MerkleTree(
        leaves,
        keccak256,
        { sortPairs: true }
      );
      const merkleProof2 = chainMerkleTree2.getHexProof(leaves[0]); // proof for the chain that will try to execute this

      // ========  Put wrong merkle root and proof in the signature ============
      const moduleSignature = defaultAbiCoder.encode(
        ["bytes32", "bytes32[]", "bytes"],
        [
          chainMerkleTree2.getHexRoot(),
          merkleProof2,
          multichainSignature,
        ]
      );
  
      // add validator module address to the signature
      const signatureWithModuleAddress = defaultAbiCoder.encode(
        ["bytes", "address"],
        [moduleSignature, multichainECDSAValidator.address]
      );
      
      // =================== put signature into userOp and execute ===================
      userOp.signature = signatureWithModuleAddress;

      await expect(
        entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000})
      ).to.be.revertedWith("FailedOp").withArgs(0, "AA24 signature error");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore);
    });

    it ("should not process a userOp with a wrong proof provided", async () => {
      const { userSA, entryPoint, multichainECDSAValidator, mockToken} = await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.591145");

      const userOp = await fillAndSign(
        {
          sender: userSA.address,
          callData: userSA.interface.encodeFunctionData(
            "executeCall_s1m",
            [
              mockToken.address,
              ethers.utils.parseEther("0"),
              encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
            ]
          ),
        },
        smartAccountOwner,
        entryPoint,
        'nonce'
      );

      const chainId = 31337;
      const nonce = await multichainECDSAValidator.getNonce(userSA.address);

      const chainLeafData3 = hexConcat([
        hexZeroPad(BigNumber.from(chainId).toHexString(), 32), // random chainId
        hexZeroPad(BigNumber.from(nonce).toHexString(), 32), //nonce
        hexZeroPad(multichainECDSAValidator.address,20),
      ]);
  
      const chainLeafData4 = hexConcat([
        hexZeroPad(BigNumber.from(4129).toHexString(), 32), // random chainId
        hexZeroPad(BigNumber.from(0).toHexString(), 32), //nonce
        hexZeroPad(multichainECDSAValidator.address,20),
      ]);
  
      // prepare the merkle tree containing the leaves with chainId info
      const leaves = [chainLeafData3, chainLeafData4].map(value => ethers.utils.keccak256(value));
      const chainMerkleTree = new MerkleTree(
        leaves,
        keccak256,
        { sortPairs: true }
      );
      const wrongMerkleProof = chainMerkleTree.getHexProof(leaves[1]); 
    
      // prepare the multichain hash
      const hash = ethers.utils.keccak256(
        hexConcat([
          await multichainECDSAValidator.getChainAgnosticUserOpHash(userOp),
          chainMerkleTree.getHexRoot(),
        ])
      );
      const multichainSignature = await smartAccountOwner.signMessage(ethers.utils.arrayify(hash));

      const moduleSignature = defaultAbiCoder.encode(
        ["bytes32", "bytes32[]", "bytes"],
        [
          chainMerkleTree.getHexRoot(),
          wrongMerkleProof,
          multichainSignature,
        ]
      );
  
      // add validator module address to the signature
      const signatureWithModuleAddress = defaultAbiCoder.encode(
        ["bytes", "address"],
        [moduleSignature, multichainECDSAValidator.address]
      );

      userOp.signature = signatureWithModuleAddress;

      await expect(
        entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000})
      ).to.be.revertedWith("FailedOp").withArgs(0, "AA23 reverted: Invalid Chain Params");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore);
    });
*/
  });

  describe ("Single chain userOp validation", async () => {

    it ("should process a userOp with a regular ECDSA single chain signature", async () => {
      const { 
        entryPoint, 
        mockToken,
        userSA,
        multichainECDSAValidator
      } = await setupTests();
  
      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");
  
      const userOp = await makeEcdsaModuleUserOp(
        "executeCall_s1m",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address
      )
  
      const handleOpsTxn = await entryPoint.handleOps([userOp], alice.address);
      await handleOpsTxn.wait();
  
      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
    });

    it ("should not process a userOp with a regular ECDSA single chain signature by the non-authorized signer", async () => {
      const { 
        entryPoint, 
        mockToken,
        userSA,
        multichainECDSAValidator
      } = await setupTests();
  
      const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");
      
      const notOwner = alice;
  
      const userOp = await makeEcdsaModuleUserOp(
        "executeCall_s1m",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        notOwner,
        entryPoint,
        multichainECDSAValidator.address
      )
        
      await expect(
        entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000})
      ).to.be.revertedWith("FailedOp").withArgs(0, "AA24 signature error");
      
      expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore);
    });
    

  });
  

});
