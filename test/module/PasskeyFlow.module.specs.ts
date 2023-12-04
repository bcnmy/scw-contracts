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
  });
});
