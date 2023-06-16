import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../utils/userOp";
import { encodeTransfer } from "../smart-wallet/testUtils";
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

describe("NEW::: SessionKey: SessionKey Manager Module", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner, refundReceiver, sessionKey] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const mockToken = await getMockToken();
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

    const sessionKeyManager = await (await ethers.getContractFactory("SessionKeyManager")).deploy();
    let userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [sessionKeyManager.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    await entryPoint.handleOps([userOp], alice.address);

    const mockSessionValidationModule = await (await ethers.getContractFactory("MockSessionValidationModule")).deploy();
    
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
    };
  });

  it ("should be enabled", async () => {
    const { userSA, sessionKeyManager } = await setupTests();
    expect(await userSA.isModuleEnabled(sessionKeyManager.address)).to.equal(true);
  });

  it ("should be able to process Session Key signed userOp via Mock session validation module", async () => {
    const { entryPoint, userSA, ecdsaModule, sessionKeyManager, mockSessionValidationModule, mockToken } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.834");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const data = hexConcat([
      hexZeroPad("0x00",6),
      hexZeroPad("0x00",6),
      hexZeroPad(mockSessionValidationModule.address,20),
      hexZeroPad(sessionKey.address, 20),
    ])

    const merkleTree = new MerkleTree(
      [ethers.utils.keccak256(data)],
      keccak256,
      { sortPairs: false, hashLeaves: false }
    );
    expect(merkleTree.getHexRoot()).to.equal(ethers.utils.keccak256(data));

    let addMerkleRootUserOp = await makeEcdsaModuleUserOp(
      "executeCall",
      [
        sessionKeyManager.address,
        ethers.utils.parseEther("0"),
        sessionKeyManager.interface.encodeFunctionData("setMerkleRoot", [merkleTree.getHexRoot()]),
      ],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    const tx = await entryPoint.handleOps([addMerkleRootUserOp], alice.address);
    await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");
    expect(
      (await sessionKeyManager.getSessionKeys(userSA.address)).merkleRoot
    ).to.equal(merkleTree.getHexRoot());
    
    const transferUserOpCalldata = SmartAccount.interface.encodeFunctionData(
      "executeCall",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ]
    );

    const transferUserOp = await fillAndSign(
      {
        sender: userSA.address,
        callData: transferUserOpCalldata,
        callGasLimit: 1_000_000,
      },
      sessionKey,  //signed by SessionKey
      entryPoint,
      "nonce"
    );
    const paddedSig = defaultAbiCoder.encode(
      //validUntil, validAfter, sessionVerificationModule address, validationData, merkleProof, signature
      ["uint48", "uint48", "address", "bytes", "bytes32[]", "bytes"],
      [ 
        0, 
        0, 
        mockSessionValidationModule.address, 
        hexZeroPad(sessionKey.address, 20), 
        merkleTree.getProof(ethers.utils.keccak256(data)), 
        transferUserOp.signature
      ]
    );
    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"], 
      [paddedSig, sessionKeyManager.address]
    );
    transferUserOp.signature = signatureWithModuleAddress;

    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    await entryPoint.handleOps([transferUserOp], alice.address, {gasLimit: 10000000});
    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
  });
  
});
