import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../utils/userOp";
import { encodeTransfer } from "../smart-wallet/testUtils";
import { arrayify, hexZeroPad, hexConcat, defaultAbiCoder } from "ethers/lib/utils";
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

describe("NEW::: SessionKey Module", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner, refundReceiver, sessionKey] = waffle.provider.getWallets();
  //let forwardFlowModule: Contract;

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

    //deploy forward flow module and enable it in the smart account
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

    const erc20SessionModule = await (await ethers.getContractFactory("ERC20SessionValidationModule")).deploy();
    
    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
      sessionKeyManager: sessionKeyManager,
      erc20SessionModule: erc20SessionModule,
    };
  });

  it ("Module is enabled", async () => {
    const { userSA, sessionKeyManager } = await setupTests();
    expect(await userSA.isModuleEnabled(sessionKeyManager.address)).to.equal(true);
  });

  it ("Module is working", async () => {
    const { entryPoint, userSA, ecdsaModule, sessionKeyManager, erc20SessionModule, mockToken } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const data = hexConcat([
      hexZeroPad("0x00",6),
      hexZeroPad("0x00",6),
      hexZeroPad(erc20SessionModule.address,20),
      hexConcat([
        hexZeroPad(sessionKey.address, 20),
        hexZeroPad(mockToken.address, 20),
        hexZeroPad(charlie.address, 20),
        hexZeroPad(ethers.constants.MaxUint256.toHexString(), 32)
      ])
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
    expect(await sessionKeyManager.sessionKeyMap(userSA.address)).to.equal(merkleTree.getHexRoot());
    
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
      ["uint48", "uint48", "address", "bytes", "bytes32[]", "bytes"],
      [0, 0, erc20SessionModule.address, hexConcat([
        hexZeroPad(sessionKey.address, 20),
        hexZeroPad(mockToken.address, 20),
        hexZeroPad(await charlie.address, 20),
        hexZeroPad(ethers.constants.MaxUint256.toHexString(), 32)
      ]), merkleTree.getProof(ethers.utils.keccak256(data)), transferUserOp.signature]
    );
    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"], 
      [paddedSig, sessionKeyManager.address]
    );
    transferUserOp.signature = signatureWithModuleAddress;

    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
      
    const tx2 = await entryPoint.handleOps([transferUserOp], alice.address);
    await expect(tx2).to.not.emit(entryPoint, "UserOperationRevertReason");
    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
  });
  
});
