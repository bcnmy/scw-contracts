import { expect } from "chai";
import { makeEcdsaSessionKeySignedUserOp, enableNewTreeForSmartAccountViaEcdsa, getERC20SessionKeyParams } from "../../utils/sessionKey";
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
import { hexZeroPad, hexConcat, defaultAbiCoder } from "ethers/lib/utils";
import { UserOperation } from "../../utils/userOperation";

describe("SessionKey: ERC721 Approval Session Validation Module", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner, sessionKey, nonAuthSessionKey] = waffle.provider.getWallets();
  const maxAmount = ethers.utils.parseEther("100");
    
  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();
    const mockNFT = await (await ethers.getContractFactory("MockNFT")).deploy();
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
    await mockNFT.mintNext(userSA.address);

    //deploy session key manager module and enable it in the smart account
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

    const erc721ApprovalSVM = await (await ethers.getContractFactory("ERC721ApprovalSessionValidationModule")).deploy();

    const sessionKeyData = hexConcat([
      hexZeroPad(sessionKey.address, 20),
      hexZeroPad(mockNFT.address, 20),
    ]);
  
    const leafData = hexConcat([
      hexZeroPad(ethers.utils.hexlify(0),6),
      hexZeroPad(ethers.utils.hexlify(0),6),
      hexZeroPad(erc721ApprovalSVM.address,20),
      sessionKeyData
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
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      mockNFT: mockNFT,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
      sessionKeyManager: sessionKeyManager,
      erc721ApprovalSVM: erc721ApprovalSVM,
      sessionKeyData: sessionKeyData,
      leafData: leafData,
      merkleTree: merkleTree,
    };
  });

  const makeErc20TransferUserOp = async function (
    token: string,
    amount: BigNumber,
    recipient: string,
    txnValue: BigNumber,
    testParams: any = {}
  ) : Promise<UserOperation> {
    const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
      "executeCall",
      [
        token,
        txnValue,
        encodeTransfer(recipient, amount.toString()),
      ],
      testParams.userSA.address,
      sessionKey,
      testParams.entryPoint,
      testParams.sessionKeyManager.address,
      0, 0,
      testParams.erc20SessionModule.address,
      testParams.sessionKeyData,
      testParams.merkleTree.getHexProof(ethers.utils.keccak256(testParams.leafData)),
    );
    return transferUserOp;
  }

  it ("should be able to process Session Key signed userOp", async () => {
    const { entryPoint, userSA, sessionKeyManager, erc721ApprovalSVM, sessionKeyData, leafData, merkleTree, mockNFT } = await setupTests();
    const Erc721 = await ethers.getContractFactory("MockNFT");

    const approvalUserOp = await makeEcdsaSessionKeySignedUserOp(
      "executeCall",
      [
        mockNFT.address,
        0,
        Erc721.interface.encodeFunctionData("setApprovalForAll", [charlie.address, true]),
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      0, 0,
      erc721ApprovalSVM.address,
      sessionKeyData,
      merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
    );

    const isCharlieOperatorBefore = await mockNFT.isApprovedForAll(userSA.address, charlie.address);
    expect(isCharlieOperatorBefore).to.be.false;
    await entryPoint.handleOps([approvalUserOp], alice.address, {gasLimit: 10000000});
    expect(await mockNFT.isApprovedForAll(userSA.address, charlie.address)).to.be.true;
  });

  it ("should revert if trying to approve wrong NFTs", async () => {
    const { entryPoint, userSA, sessionKeyManager, erc721ApprovalSVM, sessionKeyData, leafData, merkleTree, mockNFT } = await setupTests();
    const Erc721 = await ethers.getContractFactory("MockNFT");
    const randomNFT = await (await ethers.getContractFactory("MockNFT")).deploy();

    const approvalUserOp = await makeEcdsaSessionKeySignedUserOp(
      "executeCall",
      [
        randomNFT.address,
        0,
        Erc721.interface.encodeFunctionData("setApprovalForAll", [charlie.address, true]),
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      0, 0,
      erc721ApprovalSVM.address,
      sessionKeyData,
      merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
    );

    await expect(
      entryPoint.handleOps([approvalUserOp], alice.address, {gasLimit: 10000000})
    ).to.be.revertedWith("FailedOp").withArgs(0, "AA23 reverted: ERC721SV Wrong NFT contract");
    
    expect(await mockNFT.isApprovedForAll(userSA.address, charlie.address)).to.be.false;
    expect(await randomNFT.isApprovedForAll(userSA.address, charlie.address)).to.be.false;

  });
  
});
