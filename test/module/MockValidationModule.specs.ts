import { expect } from "chai";
import hre, { ethers, deployments, waffle } from "hardhat";
import { hashMessage, solidityKeccak256 } from "ethers/lib/utils";
import {
  makeEcdsaModuleUserOp,
  getUserOpHash,
  fillAndSign,
} from "../utils/userOp";
import {
  getEntryPoint,
  getSmartAccountFactory,
  getEcdsaOwnershipRegistryModule,
  deployContract,
  getMockToken,
  getSmartAccountWithModule,
} from "../utils/setupHelper";
import { encodeTransfer } from "../utils/testUtils";
import { AddressZero } from "@ethersproject/constants";
import { mock } from "node:test";

describe("ECDSA Registry Module: ", async () => {
  const [deployer, smartAccountOwner, alice, bob, charlie] =
    waffle.provider.getWallets();
  const smartAccountDeploymentIndex = 0;
  const SIG_VALIDATION_FAILED = 1;
  const EIP1271_INVALID_SIGNATURE = "0xffffffff";
  const EIP1271_MAGIC_VALUE = "0x1626ba7e";
  const SIG_VALIDATION_SUCCESS = 0;

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const saFactory = await getSmartAccountFactory();
    const mockToken = await getMockToken();

    const MockValidationModule = await hre.ethers.getContractFactory(
      "MockValidationModule"
    );

    const mockModule = await MockValidationModule.deploy();
    console.log(mockModule.address);

    const setupData = mockModule.interface.encodeFunctionData(
      "initForSmartAccount",
      []
    );

    const userSA = await getSmartAccountWithModule(
      mockModule.address,
      setupData, // can not be 0x!
      smartAccountDeploymentIndex
    );

    const tokensToMint = ethers.utils.parseEther("100");
    await mockToken.mint(userSA.address, tokensToMint.toString());
    await mockToken.mint(bob.address, tokensToMint.toString());

    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("60"),
    });

    await deployer.sendTransaction({
      to: smartAccountOwner.address,
      value: ethers.utils.parseEther("60"),
    });

    const randomContractCode = `
            contract random {
                function returnAddress() public view returns(address){
                    return address(this);
                }
            }
            `;
    const randomContract = await deployContract(deployer, randomContractCode);

    return {
      entryPoint: entryPoint,
      saFactory: saFactory,
      mockModule: mockModule,
      randomContract: randomContract,
      userSA: userSA,
      mockToken: mockToken,
    };
  });

  // validateUserOp(UserOperation calldata userOp,bytes32 userOpHash)
  describe("validateUserOp(): ", async () => {
    it("Returns SIG_VALIDATION_SUCCESS for a valid UserOp and valid userOpHash ", async () => {
      const { mockModule, entryPoint, userSA, mockToken } = await setupTests();
      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("3.5672");

      const txnData = mockToken.interface.encodeFunctionData("transfer", [
        bob.address,
        tokenAmountToTransfer.toString(),
      ]);
      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        charlie, // random dude
        entryPoint,
        mockModule.address,
        {
          preVerificationGas: 50000,
        }
      );
      // Construct userOpHash
      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const userOpHash = getUserOpHash(userOp, entryPoint.address, chainId);

      const res = await mockModule.validateUserOp(userOp, userOpHash);
      expect(res).to.be.equal(SIG_VALIDATION_SUCCESS);
      await entryPoint.handleOps([userOp], bob.address);
      expect(await mockToken.balanceOf(bob.address)).to.equal(
        bobBalanceBefore.add(tokenAmountToTransfer)
      );
      expect(await mockToken.balanceOf(userSA.address)).to.equal(
        userSABalanceBefore.sub(tokenAmountToTransfer)
      );
    });
  });

  describe("isValidSignatureForAddress(): ", async () => {
    it("Returns EIP1271_MAGIC_VALUE always", async () => {
      const { mockModule, userSA } = await setupTests();

      const stringMessage = "random dude signed this message";
      const messageHash = solidityKeccak256(["string"], [stringMessage]);
      const messageHashAndAddress = ethers.utils.arrayify(
        ethers.utils.hexConcat([messageHash, userSA.address])
      );

      // signMessage prepends the message with the prefix and length and then hashes it
      const signature = await bob.signMessage(messageHashAndAddress);

      expect(
        await mockModule.isValidSignatureForAddress(
          messageHash,
          signature,
          userSA.address
        )
      ).to.equal(EIP1271_MAGIC_VALUE);
    });
  });
});
