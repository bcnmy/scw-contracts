import { expect } from "chai";
import { makeEcdsaSessionKeySignedUserOp, enableNewTreeForSmartAccountViaEcdsa, getERC20SessionKeyParams } from "../../utils/sessionKey";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../../utils/userOp";
import { encodeTransfer } from "../../smart-wallet/testUtils";
import { arrayify, hexZeroPad, hexConcat, defaultAbiCoder } from "ethers/lib/utils";
import { 
  getEntryPoint, 
  getSmartAccountImplementation, 
  getSmartAccountFactory, 
  getMockToken, 
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import {keccak256} from "ethereumjs-util";
import { MerkleTree } from "merkletreejs";

describe("NEW::: SessionKey: ERC20 Session Validation Module", async () => {

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

  it ("should be able to process Session Key signed userOp", async () => {
    const { entryPoint, userSA, ecdsaModule, sessionKeyManager, erc20SessionModule, mockToken } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const {sessionKeyData, leafData} = await getERC20SessionKeyParams(
      sessionKey.address,
      mockToken.address,
      charlie.address,
      ethers.constants.MaxUint256,
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

    const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
      "executeCall",
      [
        mockToken.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      0, 0,
      erc20SessionModule.address,
      sessionKeyData,
      merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
    );

    const charlieTokenBalanceBefore = await mockToken.balanceOf(charlie.address);
    await entryPoint.handleOps([transferUserOp], alice.address, {gasLimit: 10000000});
    expect(await mockToken.balanceOf(charlie.address)).to.equal(charlieTokenBalanceBefore.add(tokenAmountToTransfer));
  });

  it ("should revert when userOp is for an invalid token", async () => {
    const { entryPoint, userSA, ecdsaModule, sessionKeyManager, erc20SessionModule, mockToken } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");

    const {sessionKeyData, leafData} = await getERC20SessionKeyParams(
      sessionKey.address,
      mockToken.address,
      charlie.address,
      ethers.constants.MaxUint256,
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

    const mockToken2 = await (await ethers.getContractFactory("MockToken")).deploy();
    await mockToken2.mint(userSA.address, ethers.utils.parseEther("1000000"));

    const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
      "executeCall",
      [
        mockToken2.address,
        ethers.utils.parseEther("0"),
        encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      0, 0,
      erc20SessionModule.address,
      sessionKeyData,
      merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
    );

    const charlieToken2BalanceBefore = await mockToken2.balanceOf(charlie.address);
    await expect(
      entryPoint.handleOps([transferUserOp], alice.address, {gasLimit: 10000000})
    ).to.be.revertedWith("FailedOp").withArgs(0, "AA23 reverted: ERC20SV Wrong Token");
    expect(await mockToken2.balanceOf(charlie.address)).to.equal(charlieToken2BalanceBefore);
  });

  // no value should be sent along the call

  // correct recipient is provided

  // the amount is less or equal to the max amount for the session key

  // userOp is signed by the valid session key
  
});
