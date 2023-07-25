import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import {BigNumber} from "ethers";
import { makeEcdsaModuleUserOp, fillAndSign } from "../utils/userOp";
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
import { SessionKeyManager } from "../../typechain";

describe("MultichainValidator Module", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner, refundReceiver, sessionKey, sessionKey2, fakeSessionKey] = waffle.provider.getWallets();

  const setupTests = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const smartAccountFactory = await getSmartAccountFactory();
    const mockToken = await getMockToken();
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    
    const MultichainECDSAValidator = await ethers.getContractFactory("MultichainECDSAValidator");
    const multichainECDSAValidator = await MultichainECDSAValidator.deploy();
    const sessionKeyManager = await (await ethers.getContractFactory("SessionKeyManager")).deploy();
    
    const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");
    
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

    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("10"),
    });

    const enableSessionKeyManagerData = SmartAccount.interface.encodeFunctionData(
      "enableModule",
      [sessionKeyManager.address]
    );

    const deploymentUserOp = await fillAndSign(
      {
        sender: expectedSmartAccountAddress,
        callGasLimit: 1_000_000,
        initCode: ethers.utils.hexConcat([
          smartAccountFactory.address,
          deploymentData,
        ]),
        callData: enableSessionKeyManagerData,
      },
      smartAccountOwner,
      entryPoint,
      "nonce"
    );

    const chainId = 31337;

    const leafData1 = hexConcat([
      hexZeroPad(BigNumber.from(1).toHexString(), 32), // random chainId
      hexZeroPad(BigNumber.from(0).toHexString(), 32), //nonce
      hexZeroPad(multichainECDSAValidator.address,20),
    ]);

    const leafData2 = hexConcat([
      hexZeroPad(BigNumber.from(chainId).toHexString(), 32), //chainId
      hexZeroPad(BigNumber.from(0).toHexString(), 32), //should be 0 as it is deployment
      hexZeroPad(multichainECDSAValidator.address,20),
    ]);

    const leafData3 = hexConcat([
      hexZeroPad(BigNumber.from(1888).toHexString(), 32), // random chainId
      hexZeroPad(BigNumber.from(0).toHexString(), 32), //nonce
      hexZeroPad(multichainECDSAValidator.address,20),
    ]);

    const leafData4 = hexConcat([
      hexZeroPad(BigNumber.from(4129).toHexString(), 32), // random chainId
      hexZeroPad(BigNumber.from(0).toHexString(), 32), //nonce
      hexZeroPad(multichainECDSAValidator.address,20),
    ]);

    const leaves = [leafData1, leafData2, leafData3, leafData4].map(value => ethers.utils.keccak256(value));

    const merkleTree = new MerkleTree(
      leaves,
      keccak256,
      { sortPairs: true }
    );

    const merkleProof = merkleTree.getHexProof(leaves[1]);
    console.log(merkleTree.verify(merkleTree.getProof(ethers.utils.keccak256(leafData2)), ethers.utils.keccak256(leafData2), merkleTree.getRoot()));

    const hash = ethers.utils.keccak256(
      hexConcat([
        await multichainECDSAValidator.getChainAgnosticUserOpHash(deploymentUserOp),
        merkleTree.getHexRoot(),
      ])
    );

    const multichainSignature = await smartAccountOwner.signMessage(ethers.utils.arrayify(hash));

    const moduleSignature = defaultAbiCoder.encode(
      ["bytes32", "bytes32[]", "bytes"],
      [
        merkleTree.getHexRoot(),
        merkleProof,
        multichainSignature,
      ]
    );

    // add validator module address to the signature
    const signatureWithModuleAddress = defaultAbiCoder.encode(
      ["bytes", "address"],
      [moduleSignature, multichainECDSAValidator.address]
    );
    
    deploymentUserOp.signature = signatureWithModuleAddress;
    await entryPoint.handleOps([deploymentUserOp], alice.address, {gasLimit: 10000000});

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
    };
  });

  it ("should be enabled", async () => {
    const { userSA, multichainECDSAValidator, sessionKeyManager} = await setupTests();
    expect(await userSA.isModuleEnabled(multichainECDSAValidator.address)).to.equal(true);
    expect(await userSA.isModuleEnabled(sessionKeyManager.address)).to.equal(true);
  });

});
