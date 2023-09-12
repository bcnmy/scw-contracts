import { expect } from "chai";
import hre, { ethers, deployments, waffle } from "hardhat";
import {
  getEntryPoint,
  getSmartAccountFactory,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getSmartContractOwnershipRegistryModule,
  getMockToken,
  deployContract,
} from "../utils/setupHelper";
import { getUserOpHash, makeSARegistryModuleUserOp } from "../utils/userOp";
import { encodeTransfer } from "../utils/testUtils";
import { AddressZero } from "@ethersproject/constants";
import { hashMessage } from "ethers/lib/utils";

describe("Smart Contract Ownership Registry Module: ", async () => {
  const [deployer, baseSmartAccountOwner1, baseSmartAccountOwner2, alice, bob] =
    waffle.provider.getWallets();
  const smartAccountDeploymentIndex = 0;
  const SIG_VALIDATION_SUCCESS = 0;
  const SIG_VALIDATION_FAILED = 1;
  const EIP1271_INVALID_SIGNATURE = "0xffffffff";
  const EIP1271_MAGIC_VALUE = "0x1626ba7e";

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const saFactory = await getSmartAccountFactory();
    const smartContractOwnershipRegistryModule =
      await getSmartContractOwnershipRegistryModule();
    const ecdsaRegistryModule = await getEcdsaOwnershipRegistryModule();
    const mockToken = await getMockToken();

    const ecdsaOwnershipSetupData1 =
      ecdsaRegistryModule.interface.encodeFunctionData("initForSmartAccount", [
        baseSmartAccountOwner1.address,
      ]);
    const ecdsaOwnershipSetupData2 =
      ecdsaRegistryModule.interface.encodeFunctionData("initForSmartAccount", [
        baseSmartAccountOwner2.address,
      ]);
    const smartAccountOwnerContract1 = await getSmartAccountWithModule(
      ecdsaRegistryModule.address,
      ecdsaOwnershipSetupData1,
      smartAccountDeploymentIndex
    );
    const smartAccountOwnerContract2 = await getSmartAccountWithModule(
      ecdsaRegistryModule.address,
      ecdsaOwnershipSetupData2,
      smartAccountDeploymentIndex + 1
    );

    const smartContractOwnershipSetupData =
      smartContractOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [smartAccountOwnerContract1.address]
      );
    const userSA = await getSmartAccountWithModule(
      smartContractOwnershipRegistryModule.address,
      smartContractOwnershipSetupData,
      smartAccountDeploymentIndex + 2
    );
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("60"),
    });
    const tokensToMint = ethers.utils.parseEther("100");
    await mockToken.mint(userSA.address, tokensToMint.toString());
    await mockToken.mint(bob.address, tokensToMint.toString());

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
      smartContractOwnershipRegistryModule:
        smartContractOwnershipRegistryModule,
      ecdsaRegistryModule: ecdsaRegistryModule,
      mockToken: mockToken,
      userSA: userSA,
      smartAccountOwnerContract1: smartAccountOwnerContract1,
      smartAccountOwnerContract2: smartAccountOwnerContract2,
      smartContractOwnershipSetupData: smartContractOwnershipSetupData,
      randomContract: randomContract,
    };
  });

  describe("initForSmartAccount(): ", async () => {
    it("Should successfully initialize userSA with Smart Contract as Owner", async () => {
      const {
        smartContractOwnershipRegistryModule,
        smartAccountOwnerContract1,
      } = await setupTests();

      const smartContractOwnerhsipSetupData =
        smartContractOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [smartAccountOwnerContract1.address]
        );
      const userSA = await getSmartAccountWithModule(
        smartContractOwnershipRegistryModule.address,
        smartContractOwnerhsipSetupData,
        smartAccountDeploymentIndex + 1
      );
      expect(
        await smartContractOwnershipRegistryModule.getOwner(userSA.address)
      ).to.be.equal(smartAccountOwnerContract1.address);
    });

    it("Should revert when setting up EOA as Smart Account Owner", async () => {
      const { saFactory, smartContractOwnershipRegistryModule } =
        await setupTests();

      const smartContractOwnershipSetupData =
        smartContractOwnershipRegistryModule.interface.encodeFunctionData(
          "initForSmartAccount",
          [alice.address]
        );
      const expectedSmartAccountAddress =
        await saFactory.getAddressForCounterFactualAccount(
          smartContractOwnershipRegistryModule.address,
          smartContractOwnershipSetupData,
          smartAccountDeploymentIndex
        );
      await expect(
        saFactory.deployCounterFactualAccount(
          smartContractOwnershipRegistryModule.address,
          smartContractOwnershipSetupData,
          smartAccountDeploymentIndex
        )
      ).to.be.revertedWith("NotSmartContract");
      await expect(
        smartContractOwnershipRegistryModule.getOwner(
          expectedSmartAccountAddress
        )
      ).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");
    });

    it("Should revert when calling again after initialization", async () => {
      const {
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        entryPoint,
        userSA,
      } = await setupTests();
      const txnData = ecdsaRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [bob.address]
      );
      const userOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [smartContractOwnershipRegistryModule.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
      );
      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
    });
  });

  describe("transferOwnership(): ", async () => {
    it("Should successfully transfer ownership to another Smart Contract Account", async () => {
      const {
        entryPoint,
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        userSA,
        smartAccountOwnerContract2,
      } = await setupTests();
      // Calldata to set smartAccountOwnerContract2 as owner
      const txnData =
        smartContractOwnershipRegistryModule.interface.encodeFunctionData(
          "transferOwnership",
          [smartAccountOwnerContract2.address]
        );
      const userOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [smartContractOwnershipRegistryModule.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
      );
      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");
      expect(
        await smartContractOwnershipRegistryModule.getOwner(userSA.address)
      ).to.be.equal(smartAccountOwnerContract2.address);
    });

    it("Should revert when trying to set EOA as owner rather than Smart Contract Account", async () => {
      const {
        entryPoint,
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        userSA,
      } = await setupTests();

      const previousOwner = await smartContractOwnershipRegistryModule.getOwner(
        userSA.address
      );
      const invalidEOAOwner = bob.address;
      const txnData =
        smartContractOwnershipRegistryModule.interface.encodeFunctionData(
          "transferOwnership",
          [invalidEOAOwner]
        );
      const userOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [smartContractOwnershipRegistryModule.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
      );
      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
      expect(
        await smartContractOwnershipRegistryModule.getOwner(userSA.address)
      ).to.be.equal(previousOwner);
    });

    it("Should revert when trying to set address(0) as owner", async () => {
      const {
        entryPoint,
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        userSA,
      } = await setupTests();

      const previousOwner = await smartContractOwnershipRegistryModule.getOwner(
        userSA.address
      );
      const invalidOwner = AddressZero;
      const txnData =
        smartContractOwnershipRegistryModule.interface.encodeFunctionData(
          "transferOwnership",
          [invalidOwner]
        );
      const userOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [smartContractOwnershipRegistryModule.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
      );

      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
      expect(
        await smartContractOwnershipRegistryModule.getOwner(userSA.address)
      ).to.be.equal(previousOwner);
    });
  });

  describe("renounceOwnership(): ", async () => {
    it("Should be able to renounce ownership and the new owner should be address(0)", async () => {
      const {
        entryPoint,
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        userSA,
      } = await setupTests();
      const txnData =
        smartContractOwnershipRegistryModule.interface.encodeFunctionData(
          "renounceOwnership",
          []
        );
      const userOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [smartContractOwnershipRegistryModule.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
      );
      const tx = await entryPoint.handleOps([userOp], alice.address);
      await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");
      await expect(
        smartContractOwnershipRegistryModule.getOwner(userSA.address)
      ).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");
    });
  });

  describe("validateUserOp(): ", async () => {
    it("Should return SIG_VALIDATION_SUCCESS for a valid UserOp and valid userOpHash", async () => {
      const {
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        entryPoint,
        userSA,
        mockToken,
      } = await setupTests();
      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("3.5672");

      const txnData = await mockToken.interface.encodeFunctionData("transfer", [
        bob.address,
        tokenAmountToTransfer.toString(),
      ]);
      const userOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
      );
      // Construct userOpHash
      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const userOpHash = getUserOpHash(userOp, entryPoint.address, chainId);

      const res = await smartContractOwnershipRegistryModule.validateUserOp(
        userOp,
        userOpHash
      );
      expect(res).to.be.equal(SIG_VALIDATION_SUCCESS);
      await entryPoint.handleOps([userOp], alice.address);
      expect(await mockToken.balanceOf(bob.address)).to.equal(
        bobBalanceBefore.add(tokenAmountToTransfer)
      );
      expect(await mockToken.balanceOf(userSA.address)).to.equal(
        userSABalanceBefore.sub(tokenAmountToTransfer)
      );
    });

    // Pass in valid userOp with invalid userOpHash
    it("Should return SIG_VALIDATION_FAILED when invalid chainId is passed in userOpHash", async () => {
      const {
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        entryPoint,
        mockToken,
        userSA,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("7.934");

      const txnData = mockToken.interface.encodeFunctionData("transfer", [
        bob.address,
        tokenAmountToTransfer.toString(),
      ]);
      const userOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
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
        await smartContractOwnershipRegistryModule.validateUserOp(
          userOp,
          invalidUserOpHash
        )
      ).to.be.equal(SIG_VALIDATION_FAILED);
    });

    it("Should return SIG_VALIDATION_FAILED when invalid entryPoint address is passed to userOpHash", async () => {
      const {
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        entryPoint,
        userSA,
        mockToken,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.23436");
      const txnData = mockToken.interface.encodeFunctionData("transfer", [
        bob.address,
        tokenAmountToTransfer.toString(),
      ]);
      const userOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
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
        await smartContractOwnershipRegistryModule.validateUserOp(
          userOp,
          userOpHash
        )
      ).to.be.equal(SIG_VALIDATION_FAILED);
    });

    it("Should return SIG_VALIDATION_FAILED when userOp is signed by an invalid owner ", async () => {
      const {
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        entryPoint,
        userSA,
        mockToken,
      } = await setupTests();
      const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("1.3425");

      const txnData = mockToken.interface.encodeFunctionData("transfer", [
        bob.address,
        tokenAmountToTransfer.toString(),
      ]);

      const notSmartAccountOwner = alice;
      const userOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [mockToken.address, 0, txnData],
        userSA.address,
        notSmartAccountOwner,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
      );
      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const userOpHash = getUserOpHash(userOp, entryPoint.address, chainId);

      expect(
        await smartContractOwnershipRegistryModule.validateUserOp(
          userOp,
          userOpHash
        )
      ).to.be.equal(SIG_VALIDATION_FAILED);
      await expect(
        entryPoint.handleOps([userOp], alice.address)
      ).to.be.revertedWith("FailedOp");
      expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
      expect(await mockToken.balanceOf(userSA.address)).to.equal(
        userSABalanceBefore
      );
    });

    it("Should revert when userOp.sender is an Unregistered Smart Account", async () => {
      const {
        saFactory,
        smartContractOwnershipRegistryModule,
        smartContractOwnershipSetupData,
        ecdsaRegistryModule,
        entryPoint,
        mockToken,
      } = await setupTests();
      const bobBalanceBefore = await mockToken.balanceOf(bob.address);
      const tokenAmountToTransfer = ethers.utils.parseEther("1.9999");

      // get a new smart account
      const unregisteredSmartAccountAddress =
        await saFactory.getAddressForCounterFactualAccount(
          smartContractOwnershipRegistryModule.address,
          smartContractOwnershipSetupData,
          smartAccountDeploymentIndex + 3
        );
      await saFactory.deployCounterFactualAccount(
        smartContractOwnershipRegistryModule.address,
        smartContractOwnershipSetupData,
        smartAccountDeploymentIndex + 3
      );
      const unregisteredSA = await hre.ethers.getContractAt(
        "SmartAccount",
        unregisteredSmartAccountAddress
      );

      // fund the smart account
      await mockToken.mint(
        unregisteredSmartAccountAddress,
        ethers.utils.parseEther("1000").toString()
      );
      await deployer.sendTransaction({
        to: unregisteredSmartAccountAddress,
        value: ethers.utils.parseEther("60"),
      });
      // renounce ownership
      const renounceOwnershipUserOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [
          smartContractOwnershipRegistryModule.address,
          0,
          smartContractOwnershipRegistryModule.interface.encodeFunctionData(
            "renounceOwnership",
            []
          ),
        ],
        unregisteredSmartAccountAddress,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
      );
      const handleOpsTx = await entryPoint.handleOps(
        [renounceOwnershipUserOp],
        alice.address
      );
      await expect(handleOpsTx).to.not.emit(
        entryPoint,
        "UserOperationRevertReason"
      );
      await expect(
        smartContractOwnershipRegistryModule.getOwner(unregisteredSA.address)
      ).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");

      const sendTokenUserOp = await makeSARegistryModuleUserOp(
        "execute_ncC",
        [
          mockToken.address,
          0,
          encodeTransfer(bob.address, tokenAmountToTransfer.toString()),
        ],
        unregisteredSmartAccountAddress,
        baseSmartAccountOwner1,
        entryPoint,
        smartContractOwnershipRegistryModule.address,
        ecdsaRegistryModule.address
      );

      const provider = entryPoint?.provider;
      const chainId = await provider!.getNetwork().then((net) => net.chainId);
      const userOpHash = getUserOpHash(
        sendTokenUserOp,
        entryPoint.address,
        chainId
      );
      await expect(
        smartContractOwnershipRegistryModule.validateUserOp(
          sendTokenUserOp,
          userOpHash
        )
      ).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");

      const unregisteredSABalanceBefore = await mockToken.balanceOf(
        unregisteredSA.address
      );
      await expect(
        entryPoint.handleOps([sendTokenUserOp], alice.address)
      ).to.be.revertedWith("FailedOp");
      expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
      expect(await mockToken.balanceOf(unregisteredSA.address)).to.equal(
        unregisteredSABalanceBefore
      );
    });
  });

  describe("isValidSignatureForAddress(): ", async () => {
    it("Should return EIP1271_MAGIC_VALUE for valid signature signed by Smart Account Owner", async () => {
      const {
        smartContractOwnershipRegistryModule,
        ecdsaRegistryModule,
        userSA,
      } = await setupTests();

      const messageToSign = "SCW signed this message";
      const dataHash = hashMessage(messageToSign);
      const tempSignature = await baseSmartAccountOwner1.signMessage(
        messageToSign
      );
      const moduleSignature = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"],
        [tempSignature, ecdsaRegistryModule.address]
      );
      expect(
        await smartContractOwnershipRegistryModule.isValidSignatureForAddress(
          dataHash,
          moduleSignature,
          userSA.address
        )
      ).to.equal(EIP1271_MAGIC_VALUE);
    });

    it("Should revert when Unregistered Smart Account calls isValidSignature()", async () => {
      const {
        ecdsaRegistryModule,
        smartContractOwnershipRegistryModule,
        randomContract,
      } = await setupTests();
      const unregisteredSmartAccount = randomContract.address;
      const messageToSign = "SCW signed this message";
      const dataHash = hashMessage(messageToSign);
      const tempSignature = await baseSmartAccountOwner1.signMessage(
        messageToSign
      );
      const moduleSignature = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"],
        [tempSignature, ecdsaRegistryModule.address]
      );

      // set msg.sender to be unregisteredSmartAccount instead of userSA.address
      await expect(
        smartContractOwnershipRegistryModule.isValidSignatureForAddress(
          dataHash,
          moduleSignature,
          unregisteredSmartAccount
        )
      ).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");
    });

    it("Should return 0xffffffff for signatures not signed by Smart Account Owners ", async () => {
      const {
        ecdsaRegistryModule,
        smartContractOwnershipRegistryModule,
        userSA,
      } = await setupTests();

      const messageToSign = "SCW signed this message";
      const dataHash = hashMessage(messageToSign);
      const invalidOwner = alice;
      const tempSignature = await invalidOwner.signMessage(messageToSign);
      const moduleSignature = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"],
        [tempSignature, ecdsaRegistryModule.address]
      );
      expect(
        await smartContractOwnershipRegistryModule.isValidSignatureForAddress(
          dataHash,
          moduleSignature,
          userSA.address
        )
      ).to.equal(EIP1271_INVALID_SIGNATURE);
    });
  });
});
