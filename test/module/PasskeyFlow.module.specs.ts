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
  "0xdf0512fd74006638b347e1921c624305a103133a10c6e35ac436017fbcd2b890";
const pubY =
  "0x4726e5f551a0abd8ac7867e7f887ff1f244fa04b163f0bf1834667d1775b81f3";

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
    // console.log(await passKeyModule.smartAccountPassKeys(userSA.address));
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

    const txnDataAA1 = userSA.interface.encodeFunctionData("executeCall", [
      charlie.address,
      ethers.utils.parseEther("0.1"),
      "0x",
    ]);
    // const userOp = await fillAndSign(
    //   {
    //     sender: userSA.address,
    //     callData: txnDataAA1,
    //   },
    //   // offchainSigner, // random eoa signing the transaction
    //   deployer, // random eoa signing the transaction
    //   entryPoint,
    //   "nonce"
    // );
    // userOp.signature = "";
    // console.log("userOp before", userOp);
    // // add validator module address to the signature
    // const signatureWithModuleAddress =
    //   "0x154f13ac390ea148e340b66e94125d6b30c4a807563966b0e98d18aa51a28e4ac339e0956fa12ea2798c943a6eb28fd4fa79ccffaf8661f8b7f9316bb5569f289572fd2c21fcdd6b7eea76e41889cedabfd140721d6dbb8c6f7ce6f6bb1f12f900000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000180000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000247b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000037222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a35313733222c2263726f73734f726967696e223a66616c73657d000000000000000000";

    // userOp.signature = signatureWithModuleAddress;
    // console.log("userOp", userOp);

    // const handleOpsTxn = await entryPoint.handleOps(
    //   [userOp],
    //   await offchainSigner.getAddress()
    // );
    // await handleOpsTxn.wait();
  });
});
