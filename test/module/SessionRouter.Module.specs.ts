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
import { BigNumber } from "ethers";
import { UserOperation } from "../utils/userOperation";
import { SessionRouter } from "../../typechain";
import { isCommunityResourcable } from "@ethersproject/providers";

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

    console.log("-1");

    //deploy forward flow module and enable it in the smart account
    const sessionKeyManager = await (await ethers.getContractFactory("SessionKeyManager")).deploy();
    const sessionRouter = await (await ethers.getContractFactory("SessionRouter")).deploy();

    console.log("0");

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
    
    console.log("1");


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

    console.log("2");

    const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
      [ethers.utils.keccak256(leafData), ethers.utils.keccak256(leafData2)],
      sessionKeyManager,
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );

    console.log("3");
    
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

  const makeErc20TransferUserOp = async function (
    token: string,
    amount: BigNumber,
    recipient: string,
    txnValue: BigNumber,
    testParams: any = {}
  ) : Promise<UserOperation> {
    const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
      "execute_ncC",
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

  it ("should process userOp", async () => {
    const { entryPoint, userSA, sessionKeyManager, erc20SessionModule, sessionKeyData, leafData, merkleTree, sessionRouter, mockProtocol, mockProtocolSVM, mockToken, sessionKeyData2, leafData2 } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("5.7534");

    expect(await userSA.isModuleEnabled(sessionKeyManager.address)).to.be.true;
    expect(await userSA.isModuleEnabled(sessionRouter.address)).to.be.true;

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [mockProtocol.address, tokenAmountToTransfer]);
    const interactCallData = MockProtocol.interface.encodeFunctionData("interact", [mockToken.address, tokenAmountToTransfer]);
    const executeBatchData = SmartAccount.interface.encodeFunctionData("executeBatch", [[mockToken.address, mockProtocol.address],[0,0],[approveCallData, interactCallData]]);

    console.log("it 0");

    const userOp = await fillAndSign(
      {
        sender: userSA.address,
        callData: executeBatchData,
      },
      sessionKey,
      entryPoint,
      'nonce'
    ); 

    console.log("it 1");
    
    //create a signature with the sessionKeyManager address
    const userOpHash = await entryPoint.getUserOpHash(userOp);
    console.log("userOpHash test \n", userOpHash);
    console.log("SKM test ", sessionKeyManager.address);

    /*
    const userOpHashAndModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address"],
      [userOpHash, sessionKeyManager.address]
    );*/

    const userOpHashAndModuleAddress = ethers.utils.hexConcat([
      ethers.utils.hexZeroPad(userOpHash,32),
      ethers.utils.hexZeroPad(sessionKeyManager.address,20),
    ]);

    console.log("abi encoded test \n", userOpHashAndModuleAddress);
    const resultingHash = ethers.utils.keccak256(userOpHashAndModuleAddress);
    console.log("resultingHash in test \n", resultingHash);

    console.log("Signed Message Hash in test \n", ethers.utils.hashMessage(ethers.utils.arrayify(resultingHash)));

    const signatureOverUserOpHashAndModuleAddress = await sessionKey.signMessage(ethers.utils.arrayify(resultingHash));
    

    //const {userOpHashContract, messageHashContract} = await sessionRouter.getHash(userOp, sessionKeyManager.address, entryPoint.address);
    //console.log("userOpHash in the contract: ", userOpHashContract);
    //console.log("hash in the contract:   ", messageHashContract);

    const paddedSig = ethers.utils.defaultAbiCoder.encode(
      //validUntil, validAfter, sessionVerificationModule address, validationData, merkleProof, signature
      ["address", "uint48[]", "uint48[]", "address[]", "bytes[]", "bytes32[][]", "bytes"],
      [ 
        sessionKeyManager.address,
        [0,0], 
        [0,0], 
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

    console.log("it 3");
    await entryPoint.handleOps([userOp], alice.address, {gasLimit: 10000000});
    expect(await mockToken.balanceOf(mockProtocol.address)).to.equal(tokenAmountToTransfer);
    
  });

  
});
