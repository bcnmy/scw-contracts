import { expect } from "chai";
import { Signer } from "ethers";
import { ethers } from "hardhat";
import { Deployer, Deployer__factory } from "../../typechain";

import { DEPLOYMENT_SALTS, isContract } from "../../scripts/utils";

describe("Deploy the deployer and then deploy more contracts using it", function () {
  let entryPointAddress: string;
  let factoryDeployerSigner: Signer;
  let anyDeployer: Signer;
  let deployerInstance: Deployer;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();
    factoryDeployerSigner = accounts[0];
    anyDeployer = accounts[1];

    deployerInstance = await new Deployer__factory(
      factoryDeployerSigner
    ).deploy();
    await deployerInstance.deployed();
    // console.log("deployerInstance deployed ", deployerInstance.address);
  });

  it("Deploys Entrypoint", async function () {
    const salt = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.ENTRY_POINT)
    );

    const provider = ethers.provider;

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    const entryPointBytecode = `${EntryPoint.bytecode}`;

    entryPointAddress = await deployerInstance.addressOf(salt);
    // console.log("Entry Point Computed Address: ", entryPointAddress);

    const isEntryPointDeployed = await isContract(entryPointAddress, provider); // true (deployed on-chain)
    if (!isEntryPointDeployed) {
      const code = await provider.getCode(entryPointAddress);
      expect(code).to.be.equal("0x");
      await expect(
        deployerInstance.connect(anyDeployer).deploy(salt, entryPointBytecode)
      )
        .to.emit(deployerInstance, "ContractDeployed")
        .withArgs(entryPointAddress);
    }

    // console.log("entrypoint deployed at: ", entryPointAddress);
    const code = await provider.getCode(entryPointAddress);
    expect(code).to.not.equal("0x");

    await expect(
      deployerInstance.connect(anyDeployer).deploy(salt, entryPointBytecode)
    ).to.be.revertedWith("TargetAlreadyExists");
  });

  it("Deploys MultiSend", async function () {
    const salt = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.MULTI_SEND)
    );

    const provider = ethers.provider;

    const multiSend = await ethers.getContractFactory("MultiSend");
    const multiSendBytecode = `${multiSend.bytecode}`;
    const multiSendComputedAddr = await deployerInstance.addressOf(salt);

    // console.log("MultiSend Computed Address: ", multiSendComputedAddr);

    const ismultiSendDeployed = await isContract(
      multiSendComputedAddr,
      provider
    ); // true (deployed on-chain)
    if (!ismultiSendDeployed) {
      const code = await provider.getCode(multiSendComputedAddr);
      // console.log("code before.. ", code);
      expect(code).to.be.equal("0x");
      await deployerInstance
        .connect(anyDeployer)
        .deploy(salt, multiSendBytecode);
    }

    // console.log("entrypoint deployed at: ", multiSendComputedAddr);
    const code = await provider.getCode(multiSendComputedAddr);
    // console.log("code after.. ", code);
    expect(code).to.not.equal("0x");

    await expect(
      deployerInstance.connect(anyDeployer).deploy(salt, multiSendBytecode)
    ).to.be.revertedWith("TargetAlreadyExists");
  });
});
