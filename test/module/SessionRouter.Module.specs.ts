import { expect, use } from "chai";
import { makeEcdsaSessionKeySignedUserOp, enableNewTreeForSmartAccountViaEcdsa, getERC20SessionKeyParams, addLeavesForSmartAccountViaEcdsa } from "../utils/sessionKey";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../utils/userOp";
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
import { MerkleTree } from "merkletreejs";
import { intToHex } from "ethereumjs-util";


describe("SessionKey: Session Router", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner, refundReceiver, sessionKey, nonAuthSessionKey] = waffle.provider.getWallets();
  const maxAmount = ethers.utils.parseEther("100");
    
  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();
    const mockToken = await getMockToken();
    const entryPoint = await getEntryPoint();
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory("EcdsaOwnershipRegistryModule");
    let ecdsaOwnershipSetupData = EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
      "initForSmartAccount",
      [await smartAccountOwner.getAddress()]
    );
    const smartAccountDeploymentIndex = 0;
    const userSA = await getSmartAccountWithModule(ecdsaModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex);

    // send funds to userSA and mint tokens
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    //deploy forward flow module and enable it in the smart account
    const sessionKeyManager = await (await ethers.getContractFactory("SessionKeyManager")).deploy();
    const sessionRouter = await (await ethers.getContractFactory("SessionRouter")).deploy();

    let userOp1 = await makeEcdsaModuleUserOp(
      "enableModule",
      [sessionKeyManager.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );

    await entryPoint.handleOps([userOp1], alice.address);


    let userOp2 = await makeEcdsaModuleUserOp(
      "enableModule",
      [sessionRouter.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );

    await entryPoint.handleOps([userOp2], alice.address);

    const erc20SessionModule = await (await ethers.getContractFactory("ERC20SessionValidationModule")).deploy();
    //MockProtocol contract
    const mockProtocol = await (await ethers.getContractFactory("MockProtocol")).deploy();
    //MockProtocol SV Module
    const mockProtocolSVModule = await (await ethers.getContractFactory("MockProtocolSVM")).deploy();

    const {sessionKeyData, leafData} = await getERC20SessionKeyParams(
      sessionKey.address,
      mockToken.address,
      mockProtocol.address,
      maxAmount,
      0,
      0,
      erc20SessionModule.address
    );

    //create leaf for the fakeswap sv module
    const {sessionKeyData: sessionKeyData2, leafData: leafData2} = await getERC20SessionKeyParams(
      sessionKey.address,
      mockProtocol.address, //contract to interact with
      mockToken.address, // token to transfer to protocol
      maxAmount,
      0,
      0,
      mockProtocolSVModule.address
    );

    // build a big tree
    let leaves = [ethers.utils.keccak256(leafData)];
    for(let i = 0; i < 9999; i++) {
      if(i == 4988) {
        leaves.push(ethers.utils.keccak256(leafData2));
      }
      leaves.push(ethers.utils.keccak256(ethers.utils.randomBytes(32)));
    }

    const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
      leaves,
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
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
      sessionKeyManager: sessionKeyManager,
      erc20SessionModule: erc20SessionModule,
      sessionKeyData: sessionKeyData,
      leafData: leafData,
      sessionKeyData2: sessionKeyData2,
      leafData2: leafData2,
      merkleTree: merkleTree,
      sessionRouter: sessionRouter,
      mockProtocol: mockProtocol,
      mockProtocolSVM: mockProtocolSVModule,
    };
  });

  it ("MOVED: Should process Session Key signed executeBatch userOp", async () => {
      //moved to test/bundler-integrations/module/SessionRouter.Module.specs.ts
  });

  it ("Should revert for a non executeBatch userOp", async () => {
    const { entryPoint, userSA, sessionKeyManager, erc20SessionModule, sessionKeyData, leafData, merkleTree, sessionRouter, mockProtocol, mockProtocolSVM, mockToken, sessionKeyData2, leafData2 } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const IERC20 = await ethers.getContractFactory("ERC20");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [mockProtocol.address, tokenAmountToTransfer.mul(50)]);
    const executeData = SmartAccount.interface.encodeFunctionData("execute", 
      [mockToken.address,0,approveCallData]
    );

    const userOp = await fillAndSign(
      {
        sender: userSA.address,
        callData: executeData,
      },
      sessionKey,
      entryPoint,
      'nonce'
    ); 
    
    //create a signature with the sessionKeyManager address
    const userOpHash = await entryPoint.getUserOpHash(userOp);
    const userOpHashAndModuleAddress = ethers.utils.hexConcat([
      ethers.utils.hexZeroPad(userOpHash,32),
      ethers.utils.hexZeroPad(sessionKeyManager.address,20),
    ]);
    const resultingHash = ethers.utils.keccak256(userOpHashAndModuleAddress);
    const signatureOverUserOpHashAndModuleAddress = await sessionKey.signMessage(ethers.utils.arrayify(resultingHash));

    const paddedSig = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint48[]", "uint48[]", "address[]", "bytes[]", "bytes32[][]", "bytes"],
      [ 
        sessionKeyManager.address,
        [0], 
        [0], 
        [erc20SessionModule.address], 
        [sessionKeyData], 
        [merkleTree.getHexProof(ethers.utils.keccak256(leafData))], 
        signatureOverUserOpHashAndModuleAddress
      ]
    );

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"], 
      [paddedSig, sessionRouter.address]
    );
    userOp.signature = signatureWithModuleAddress;

    await expect(
      entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000})
    ).to.be.revertedWith("FailedOp").withArgs(0, "AA23 reverted: SR Invalid Selector");
  });

  it ("Should revert if padded signature is in wrong format", async () => {
    const { entryPoint, userSA, sessionKeyManager, erc20SessionModule, sessionKeyData, leafData, merkleTree, sessionRouter, mockProtocol, mockProtocolSVM, mockToken, sessionKeyData2, leafData2 } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [mockProtocol.address, tokenAmountToTransfer]);
    const interactCallData = MockProtocol.interface.encodeFunctionData("interact", [mockToken.address, tokenAmountToTransfer]);
    const executeBatchData = SmartAccount.interface.encodeFunctionData("executeBatch_y6U", [[mockToken.address, mockProtocol.address],[0,0],[approveCallData, interactCallData]]);

    const userOp = await fillAndSign(
      {
        sender: userSA.address,
        callData: executeBatchData,
      },
      sessionKey,
      entryPoint,
      'nonce'
    ); 
    
    //create a signature with the sessionKeyManager address
    const userOpHash = await entryPoint.getUserOpHash(userOp);
    const userOpHashAndModuleAddress = ethers.utils.hexConcat([
      ethers.utils.hexZeroPad(userOpHash,32),
      ethers.utils.hexZeroPad(sessionKeyManager.address,20),
    ]);
    const resultingHash = ethers.utils.keccak256(userOpHashAndModuleAddress);
    const signatureOverUserOpHashAndModuleAddress = await sessionKey.signMessage(ethers.utils.arrayify(resultingHash));
    
    const paddedSig = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint48", "uint48", "address[]", "bytes[]", "bytes32[][]", "bytes"],
      [ 
        sessionKeyManager.address,
        0, //signle value instead of an array 
        0, //signle value instead of an array 
        [erc20SessionModule.address, mockProtocolSVM.address], 
        [sessionKeyData, sessionKeyData2], 
        [merkleTree.getHexProof(ethers.utils.keccak256(leafData)), merkleTree.getHexProof(ethers.utils.keccak256(leafData2))], 
        signatureOverUserOpHashAndModuleAddress
      ]
    );

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"], 
      [paddedSig, sessionRouter.address]
    );
    userOp.signature = signatureWithModuleAddress;

    await expect(
      entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000})
    ).to.be.revertedWith("FailedOp").withArgs(0, "AA23 reverted (or OOG)");
  });

  
});
