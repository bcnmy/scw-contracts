import { expect } from "chai";
import { Contract } from "ethers";
import { deployments, ethers, waffle } from "hardhat";
import {
  getEntryPoint,
  getSmartAccountFactory,
  getSmartAccountWithModule,
} from "../utils/setupHelper";
import { fillAndSign } from "../utils/userOp";

const keyId = "test";
const pubX =
  "0xa736f00b7d22e878a2fe3836773219ddac3c9b2bdcb066b3c480232262b410ad";
const pubY =
  "0xd238d6f412bbf0334a592d4cba3862d28853f9f27d4ff6a9546de355761eb0f8";

describe("Passkeys Registry Module:", function () {
  const [deployer, offchainSigner, charlie] = waffle.provider.getWallets();
  let passKeyModule: Contract;

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    // deploy passkey module
    passKeyModule = await (
      await ethers.getContractFactory("PasskeyRegistryModule")
    ).deploy();
    //  deploy the smart account
    const passkeyOwnershipSetupData =
      passKeyModule.interface.encodeFunctionData("initForSmartAccount", [
        pubX,
        pubY,
        keyId,
      ]);
    const userSA = await getSmartAccountWithModule(
      passKeyModule.address,
      passkeyOwnershipSetupData,
      0 // smartAccountDeploymentIndex
    );

    // send funds to userSA and mint tokens
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });
    // await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    return {
      entryPoint: entryPoint,
      smartAccountFactory: await getSmartAccountFactory(),
      passkeyRegistryModule: passKeyModule,
      userSA: userSA,
    };
  });

  it("Deploys Modular Smart Account with Passkey Validation Module", async () => {
    const { userSA } = await setupTests();
    expect(await userSA.isModuleEnabled(passKeyModule.address)).to.equal(true);
    // console.log(await passKeyModule.smartAccountPassKeys(userSA.address));
    // verify pubX and pubY is set or not
    expect(
      (await passKeyModule.smartAccountPassKeys(userSA.address))[0].valueOf()
    ).to.equal(pubX);
    expect(
      (await passKeyModule.smartAccountPassKeys(userSA.address))[1].valueOf()
    ).to.equal(pubY);
    expect(
      (await passKeyModule.smartAccountPassKeys(userSA.address))[2].valueOf()
    ).to.equal(keyId);

    expect(await ethers.provider.getBalance(userSA.address)).to.equal(
      ethers.utils.parseEther("10")
    );
  });

  it("Can send a userOp with a default validation module", async () => {
    const { userSA, entryPoint } = await setupTests();

    const txnDataAA1 = userSA.interface.encodeFunctionData("execute", [
      charlie.address,
      ethers.utils.parseEther("1"),
      "0x",
    ]);
    const userOp1 = await fillAndSign(
      {
        sender: userSA.address,
        callData: txnDataAA1,
      },
      offchainSigner, // random eoa signing the transaction
      entryPoint,
      "nonce"
    );
    userOp1.signature = "";
    console.log("userOp1 before", userOp1);
    // add validator module address to the signature
    // const signatureWithModuleAddress =
    //   "0x26877a3a3c8313f8a23dd5323d74523613e8ed12581731be9df482b969efc6b0917f457dfe4fea9bffa6323a29e9ca56bebcec612129f76883690434ae168e3d1d9dbfe496790f59daeeb62c5c8b00fc5a9751c9caa76b194e5472b190b8690100000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000180000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000247b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000037222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a35313733222c2263726f73734f726967696e223a66616c73657d000000000000000000";

    // userOp1.signature = signatureWithModuleAddress;
    // console.log("userOp1", userOp1);

    // const handleOpsTxn = await entryPoint.handleOps(
    //   [userOp1],
    //   await offchainSigner.getAddress(),
    //   {
    //     gasLimit: 20000000,
    //   }
    // );
    // await handleOpsTxn.wait();
  });
});
