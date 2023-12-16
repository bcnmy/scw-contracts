import { expect } from "chai";
import hre, { ethers, deployments, waffle, network } from "hardhat";
import { solidityKeccak256 } from "ethers/lib/utils";
import {
  getEntryPoint,
  getSmartAccountFactory,
  getSmartAccountWithModule,
  getMockToken,
} from "../../utils/setupHelper";
import {
  getStealthAddressFromWallet,
  getAggregateSig,
} from "../../utils/stealthUtil";
import {
  getUserOpHash,
  makeStealthAddressModuleUserOp,
} from "../../utils/userOp";
import { encodeTransfer } from "../../utils/testUtils";

describe("Stealth Address Registry Module", () => {
  const [deployer, smartAccountOwner, alice, bob, charlie] =
    waffle.provider.getWallets();
  const smartAccountDeploymentIndex = 0;
  const SIG_VALIDATION_FAILED = 1;
  const EIP1271_INVALID_SIGNATURE = "0xffffffff";
  const EIP1271_MAGIC_VALUE = "0x1626ba7e";

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const saFactory = await getSmartAccountFactory();

    const stealthAggregateSignature = await (
      await ethers.getContractFactory("StealthAggreagteSignature", {})
    ).deploy();
    const stealthRegistryModule = await (
      await ethers.getContractFactory("StealthAddressRegistryModule", {
        libraries: {
          StealthAggreagteSignature: stealthAggregateSignature.address,
        },
      })
    ).deploy();
    const mockToken = await getMockToken();

    const stealthInfo = await getStealthAddressFromWallet(smartAccountOwner);

    const stealthRegistryModuleSetupData =
      stealthRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [
          stealthInfo.stealthAddress,
          stealthInfo.stealthPub,
          stealthInfo.dhkey,
          stealthInfo.ephemeralPub,
          stealthInfo.stealthPrefix,
          stealthInfo.dhkeyPrefix,
          stealthInfo.ephemeralPrefix,
        ]
      );
    const userSA = await getSmartAccountWithModule(
      stealthRegistryModule.address,
      stealthRegistryModuleSetupData,
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

    return {
      entryPoint,
      saFactory,
      stealthAggregateSignature,
      stealthRegistryModule,
      stealthRegistryModuleSetupData,
      userSA,
      mockToken,
      stealthInfo,
    };
  });

  describe("initForSmartAccount", async () => {
    it("Reverts when calling again after initialization", async () => {
      const { stealthRegistryModule, userSA, entryPoint, stealthInfo } =
        await setupTests();

      const stealthInfoBob = await getStealthAddressFromWallet(bob);

      const txnData1 = stealthRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [
          stealthInfoBob.stealthAddress,
          stealthInfoBob.stealthPub,
          stealthInfoBob.dhkey,
          stealthInfoBob.ephemeralPub,
          stealthInfoBob.stealthPrefix,
          stealthInfoBob.dhkeyPrefix,
          stealthInfoBob.ephemeralPrefix,
        ]
      );
      const userOp = await makeStealthAddressModuleUserOp(
        "execute_ncC",
        [stealthRegistryModule.address, 0, txnData1],
        userSA.address,
        stealthInfo.stealthWallet,
        entryPoint,
        stealthRegistryModule.address,
        stealthInfo.hashSharedSecret,
        0
      );

      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
    });
  });

  describe("validateUserOp(): ", async () => {
    it("Returns SIG_VALIDATION_FAILED when invalid chainId is passed in userOpHash", async () => {
      const {
        stealthRegistryModule,
        userSA,
        entryPoint,
        mockToken,
        stealthInfo,
      } = await setupTests();

      const tokenAmountToTransfer = ethers.utils.parseEther("7.934");

      const txnData = encodeTransfer(
        bob.address,
        tokenAmountToTransfer.toString()
      );

      const userOp = await makeStealthAddressModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        stealthInfo.stealthWallet,
        entryPoint,
        stealthRegistryModule.address,
        stealthInfo.hashSharedSecret,
        0
      );
      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const invalidChainId = 2 * chainId;
      const invalidUserOpHash = getUserOpHash(
        userOp,
        entryPoint.address,
        invalidChainId
      );
      expect(
        await stealthRegistryModule.validateUserOp(userOp, invalidUserOpHash)
      ).to.be.equal(SIG_VALIDATION_FAILED);
    });

    it("Returns SIG_VALIDATION_FAILED when invalid entryPoint address is passed to userOpHash", async () => {
      const {
        stealthRegistryModule,
        userSA,
        entryPoint,
        mockToken,
        stealthInfo,
      } = await setupTests();

      const tokenAmountToTransfer = ethers.utils.parseEther("0.23436");

      const txnData = encodeTransfer(
        bob.address,
        tokenAmountToTransfer.toString()
      );

      const userOp = await makeStealthAddressModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        stealthInfo.stealthWallet,
        entryPoint,
        stealthRegistryModule.address,
        stealthInfo.hashSharedSecret,
        0
      );
      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const invalidEntryPointAddress = bob.address;
      const userOpHash = getUserOpHash(
        userOp,
        invalidEntryPointAddress,
        chainId
      );
      expect(
        await stealthRegistryModule.validateUserOp(userOp, userOpHash)
      ).to.be.equal(SIG_VALIDATION_FAILED);
    });

    it("Returns SIG_VALIDATION_FAILED when userOp is signed by an invalid stealth address", async () => {
      const {
        stealthRegistryModule,
        userSA,
        entryPoint,
        mockToken,
        stealthInfo,
      } = await setupTests();
      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("1.3425");

      const txnData = encodeTransfer(
        bob.address,
        tokenAmountToTransfer.toString()
      );

      const notSmartAccountOwner = charlie;
      const userOp = await makeStealthAddressModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        notSmartAccountOwner,
        entryPoint,
        stealthRegistryModule.address,
        stealthInfo.hashSharedSecret,
        0
      );
      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const userOpHash = getUserOpHash(userOp, entryPoint.address, chainId);
      expect(
        await stealthRegistryModule.validateUserOp(userOp, userOpHash)
      ).to.be.equal(SIG_VALIDATION_FAILED);
      await expect(
        entryPoint.handleOps([userOp], smartAccountOwner.address)
      ).to.be.revertedWith("FailedOp");
      expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
      expect(await mockToken.balanceOf(userSA.address)).to.equal(
        userSABalanceBefore
      );
    });

    it("Reverts when length of user.signature is less than 65 ", async () => {
      const {
        stealthRegistryModule,
        userSA,
        entryPoint,
        mockToken,
        stealthInfo,
      } = await setupTests();
      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("3.632");

      const txnData = encodeTransfer(
        bob.address,
        tokenAmountToTransfer.toString()
      );
      const userOp = await makeStealthAddressModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        stealthInfo.stealthWallet,
        entryPoint,
        stealthRegistryModule.address,
        stealthInfo.hashSharedSecret,
        0
      );
      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const userOpHash = await getUserOpHash(
        userOp,
        entryPoint.address,
        chainId
      );
      // construct signature of length < 65
      const invalidSignature = new Uint8Array(64);
      invalidSignature[0] = 0;
      for (let i = 1; i < invalidSignature.length; i++) {
        invalidSignature[i] = i; // Set each byte to its index value
      }
      const invalidSignatureWithModuleAddress =
        ethers.utils.defaultAbiCoder.encode(
          ["bytes", "address"],
          [invalidSignature, stealthRegistryModule.address]
        );
      userOp.signature = invalidSignatureWithModuleAddress;
      await expect(
        stealthRegistryModule.validateUserOp(userOp, userOpHash)
      ).to.be.revertedWith("ECDSA: invalid signature length");
      await expect(entryPoint.handleOps([userOp], smartAccountOwner.address)).to
        .be.reverted;
      expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
      expect(await mockToken.balanceOf(userSA.address)).to.equal(
        userSABalanceBefore
      );
    });
  });

  describe("isValidSignature(): ", async () => {
    it("Returns EIP1271_MAGIC_VALUE for valid signature signed by Stealth address wallet", async () => {
      const { stealthRegistryModule, userSA, stealthInfo } = await setupTests();
      const stringMessage = "SCW signed this message";
      const message = ethers.utils.arrayify(
        solidityKeccak256(["string"], [stringMessage])
      );
      const signature = await stealthInfo.stealthWallet.signMessage(message);
      const concatSig = ethers.utils.hexConcat(["0x00", signature]);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [userSA.address],
      });
      const mockAAsSigner = await ethers.getSigner(userSA.address);
      expect(
        await stealthRegistryModule
          .connect(mockAAsSigner)
          .isValidSignature(message, concatSig)
      ).to.equal(EIP1271_MAGIC_VALUE);
    });

    it("Returns EIP1271_MAGIC_VALUE for aggregated valid signature signed by Stealth address owner", async () => {
      const { stealthRegistryModule, userSA, stealthInfo } = await setupTests();
      const stringMessage = "SCW signed this message";
      const message = ethers.utils.arrayify(
        solidityKeccak256(["string"], [stringMessage])
      );
      const signature = await getAggregateSig(
        smartAccountOwner,
        stealthInfo.hashSharedSecret,
        message
      );
      const concatSig = ethers.utils.hexConcat(["0x01", signature]);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [userSA.address],
      });
      const mockAAsSigner = await ethers.getSigner(userSA.address);
      expect(
        await stealthRegistryModule
          .connect(mockAAsSigner)
          .isValidSignature(message, concatSig)
      ).to.equal(EIP1271_MAGIC_VALUE);
    });

    it("Reverts when signature length is less than 65", async () => {
      const { stealthRegistryModule, userSA } = await setupTests();

      const stringMessage = "SCW signed this message";
      const message = ethers.utils.arrayify(
        solidityKeccak256(["string"], [stringMessage])
      );

      // construct signature of length < 65
      const invalidSignature = new Uint8Array(64);
      for (let i = 0; i < invalidSignature.length; i++) {
        invalidSignature[i] = i; // Set each byte to its index value
      }
      const concatSig = ethers.utils.hexConcat(["0x00", invalidSignature]);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [userSA.address],
      });
      const mockAAsSigner = await ethers.getSigner(userSA.address);
      await expect(
        stealthRegistryModule
          .connect(mockAAsSigner)
          .isValidSignature(message, concatSig)
      ).to.be.revertedWith("ECDSA: invalid signature length");
    });

    it("Returns 0xffffffff for signatures not signed by Smart Account Owners ", async () => {
      const { stealthRegistryModule, userSA } = await setupTests();
      const stringMessage = "SCW signed this message";
      const message = ethers.utils.arrayify(
        solidityKeccak256(["string"], [stringMessage])
      );
      const signature = await bob.signMessage(message);
      const concatSig = ethers.utils.hexConcat(["0x00", signature]);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [userSA.address],
      });
      const mockAAsSigner = await ethers.getSigner(userSA.address);
      expect(
        await stealthRegistryModule
          .connect(mockAAsSigner)
          .isValidSignature(message, concatSig)
      ).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    it("Can not replay signature for the SA with the same owner", async () => {
      const {
        stealthRegistryModule,
        stealthRegistryModuleSetupData,
        saFactory,
        userSA,
        stealthInfo,
      } = await setupTests();
      const stringMessage = "SCW signed this message";
      const message = ethers.utils.arrayify(
        solidityKeccak256(["string"], [stringMessage])
      );
      const signature = await stealthInfo.stealthWallet.signMessage(message);
      const concatSig = ethers.utils.hexConcat(["0x00", signature]);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [userSA.address],
      });
      const mockAAsSigner = await ethers.getSigner(userSA.address);
      expect(
        await stealthRegistryModule
          .connect(mockAAsSigner)
          .isValidSignature(message, concatSig)
      ).to.equal(EIP1271_MAGIC_VALUE);

      // get a new smart account
      const userSA2Address = await saFactory.getAddressForCounterFactualAccount(
        stealthRegistryModule.address,
        stealthRegistryModuleSetupData,
        smartAccountDeploymentIndex + 1
      );
      await saFactory.deployCounterFactualAccount(
        stealthRegistryModule.address,
        stealthRegistryModuleSetupData,
        smartAccountDeploymentIndex + 1
      );
      const userSA2 = await hre.ethers.getContractAt(
        "SmartAccount",
        userSA2Address
      );
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [userSA.address],
      });
      const mockAAsSigner2 = await ethers.getSigner(userSA2.address);

      expect(
        await stealthRegistryModule
          .connect(mockAAsSigner2)
          .isValidSignature(message, signature)
      ).to.equal(EIP1271_INVALID_SIGNATURE);
    });
  });

  describe("validateAggregatedSignature() ", async () => {
    it("Returns true for valid aggregated signature signed by Stealth address owner", async () => {
      const { stealthAggregateSignature, stealthInfo } = await setupTests();
      const stringMessage = "SCW signed this message";
      const message = ethers.utils.arrayify(
        solidityKeccak256(["string"], [stringMessage])
      );

      const hashMessage = ethers.utils.hashMessage(message);
      const signature = await getAggregateSig(
        smartAccountOwner,
        stealthInfo.hashSharedSecret,
        message
      );

      expect(
        await stealthAggregateSignature.validateAggregatedSignature(
          stealthInfo.stealthPub,
          stealthInfo.dhkey,
          stealthInfo.stealthPrefix,
          stealthInfo.dhkeyPrefix,
          hashMessage,
          signature
        )
      ).to.equal(true);
    });
  });
});
