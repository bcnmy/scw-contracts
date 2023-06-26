import { expect } from "chai";
import hre , { ethers, deployments, waffle } from "hardhat";
import { hashMessage } from "ethers/lib/utils";
import { makeEcdsaModuleUserOp, getUserOpHash } from "../utils/userOp";
import {getEntryPoint,getSmartAccountFactory, getEcdsaOwnershipRegistryModule,deployContract, getMockToken, getSmartAccountWithModule} from "../utils/setupHelper";
import { encodeTransfer } from "../utils/testUtils";
import { AddressZero } from "@ethersproject/constants";

describe("ECDSA Registry Module: ", async()=>{

    const [deployer, smartAccountOwner, alice, bob, charlie] = waffle.provider.getWallets();
    const smartAccountDeploymentIndex = 0;
    const SIG_VALIDATION_SUCCESS = 0;
    const SIG_VALIDATION_FAILED = 1;
    const EIP1271_INVALID_SIGNATURE = "0xffffffff";
    const EIP1271_MAGIC_VALUE = "0x1626ba7e";

    const setupTests = deployments.createFixture(async( {deployments, getNamedAccounts} ) =>{
        await deployments.fixture();

        const entryPoint = await getEntryPoint();
        const saFactory = await getSmartAccountFactory();
        const ecdsaRegistryModule = await getEcdsaOwnershipRegistryModule();
        const mockToken = await getMockToken();

        let ecdsaOwnershipSetupData = ecdsaRegistryModule.interface.encodeFunctionData(
            "initForSmartAccount",
            [smartAccountOwner.address]
        );
        const userSA = await getSmartAccountWithModule(ecdsaRegistryModule.address, ecdsaOwnershipSetupData, smartAccountDeploymentIndex);

        const tokensToMint = ethers.utils.parseEther("100");
        await mockToken.mint(userSA.address,tokensToMint.toString());
        await mockToken.mint(bob.address,tokensToMint.toString());

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
        const randomContract = await deployContract(deployer,randomContractCode);

        return {
            entryPoint: entryPoint,
            saFactory: saFactory,
            ecdsaRegistryModule: ecdsaRegistryModule,
            ecdsaOwnershipSetupData: ecdsaOwnershipSetupData,
            randomContract: randomContract,
            userSA: userSA,
            mockToken: mockToken,
        };
    });

    describe("initForSmartAccount: ", async() =>{
        it("Reverts when trying to set Smart Contract as owner of the Smart Account", async()=>{
            const {saFactory,ecdsaRegistryModule, randomContract} = await setupTests();
            let EcdsaOwnershipSetupData = ecdsaRegistryModule.interface.encodeFunctionData(
                "initForSmartAccount",
                [randomContract.address]
              );

            const expectedSmartAccountAddress = await saFactory.getAddressForCounterFactualAccount(ecdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex+1);
            await expect(saFactory.deployCounterFactualAccount(ecdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex)).to.be.revertedWith("NotEOA");
            await expect(ecdsaRegistryModule.getOwner(expectedSmartAccountAddress)).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");
        });

        it("Reverts when calling again after initialization", async()=>{
            const {ecdsaRegistryModule,entryPoint,userSA} = await setupTests();
            const txnData1 = ecdsaRegistryModule.interface.encodeFunctionData(
                "initForSmartAccount",
                [bob.address],
            );
            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [ecdsaRegistryModule.address,0, txnData1],
                userSA.address,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );
            const tx = await entryPoint.handleOps([userOp], alice.address);
            await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
        });

    });

    describe("transferOwnership: ",async()=>{
        it("Call transferOwnership from userSA and it successfully changes owner ", async()=>{
            const {ecdsaRegistryModule,entryPoint,userSA} = await setupTests();
            // Calldata to set Bob as owner
            let txnData1 = ecdsaRegistryModule.interface.encodeFunctionData(
                "transferOwnership",
                [bob.address]
            );
            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [ecdsaRegistryModule.address,0,txnData1],
                userSA.address,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );

            const tx = await entryPoint.handleOps([userOp],charlie.address);
            await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");
            expect(await ecdsaRegistryModule.getOwner(userSA.address)).to.be.equal(bob.address);
        });

        it("Reverts when trying to set Smart Contract Address as owner via transferOwnership() ", async()=>{
            const {ecdsaRegistryModule,entryPoint, randomContract, userSA} = await setupTests();
            const previousOwner = await ecdsaRegistryModule.getOwner(userSA.address);
            let txnData1 = ecdsaRegistryModule.interface.encodeFunctionData(
                "transferOwnership",
                [randomContract.address]
            );
            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [ecdsaRegistryModule.address,0,txnData1],
                userSA.address,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );

            const tx = await entryPoint.handleOps([userOp],charlie.address);
            await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
            expect(await ecdsaRegistryModule.getOwner(userSA.address)).to.be.equal(previousOwner);
        });

        it("Reverts when trying to set address(0) as owner", async()=>{
            const {ecdsaRegistryModule,entryPoint, randomContract, userSA} = await setupTests();
            const previousOwner = await ecdsaRegistryModule.getOwner(userSA.address);
            let txnData1 = ecdsaRegistryModule.interface.encodeFunctionData(
                "transferOwnership",
                [AddressZero]
            );
            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [ecdsaRegistryModule.address,0,txnData1],
                userSA.address,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );

            const tx = await entryPoint.handleOps([userOp],charlie.address);
            await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
            expect(await ecdsaRegistryModule.getOwner(userSA.address)).to.be.equal(previousOwner);
        });
    });

    describe("renounceOwnership():", async()=>{
        it("Should be able to renounce ownership and the new owner should be address(0)", async()=>{
            const {ecdsaRegistryModule, entryPoint, userSA} = await setupTests();
            let txnData1 = ecdsaRegistryModule.interface.encodeFunctionData(
                "renounceOwnership",
                []
            );
            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [ecdsaRegistryModule.address,0,txnData1],
                userSA.address,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );

            const tx = await entryPoint.handleOps([userOp],charlie.address);
            await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");
            await expect(ecdsaRegistryModule.getOwner(userSA.address)).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");
        });
    });

    // validateUserOp(UserOperation calldata userOp,bytes32 userOpHash)
    describe("validateUserOp(): ", async()=>{

        it("Returns SIG_VALIDATION_SUCCESS for a valid UserOp and valid userOpHash ", async()=>{
            const {ecdsaRegistryModule,entryPoint,userSA,mockToken} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("3.5672");

            let txnData = await mockToken.interface.encodeFunctionData(
                "transfer",
                [bob.address,tokenAmountToTransfer.toString()]
            );
            const userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [mockToken.address,0,txnData],
                userSA.address,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );
            // Construct userOpHash
            const provider = entryPoint?.provider;
            const chainId = await provider!.getNetwork().then((net) => net.chainId);
            const userOpHash = getUserOpHash(userOp,entryPoint.address,chainId);
            
            let res = await ecdsaRegistryModule.validateUserOp(userOp, userOpHash);
            expect(res).to.be.equal(SIG_VALIDATION_SUCCESS);
            await entryPoint.handleOps([userOp],smartAccountOwner.address);
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore.add(tokenAmountToTransfer));
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore.sub(tokenAmountToTransfer));
        });

        // Pass in valid userOp with invalid userOpHash
        it("Returns SIG_VALIDATION_FAILED when invalid chainId is passed in userOpHash", async()=>{
            const {ecdsaRegistryModule, entryPoint, mockToken, userSA} = await setupTests();
            const tokenAmountToTransfer = ethers.utils.parseEther("7.934");

            let txnData = mockToken.interface.encodeFunctionData(
                "transfer",
                [bob.address,tokenAmountToTransfer.toString()]
            );
            const userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [mockToken.address,0,txnData],
                userSA.address,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );
            const provider = entryPoint?.provider;
            const chainId = await provider!.getNetwork().then((net) => net.chainId);
            const invalidChainId = 2* chainId;
            const invalidUserOpHash = getUserOpHash(userOp,entryPoint.address,invalidChainId);

            expect(await ecdsaRegistryModule.validateUserOp(userOp,invalidUserOpHash)).to.be.equal(SIG_VALIDATION_FAILED);
        });

        it("Returns SIG_VALIDATION_FAILED when invalid entryPoint address is passed to userOpHash" ,async()=>{
            const {ecdsaRegistryModule, entryPoint, userSA, mockToken} = await setupTests();
            const tokenAmountToTransfer = ethers.utils.parseEther("0.23436");

            let txnData = mockToken.interface.encodeFunctionData(
                "transfer",
                [bob.address,tokenAmountToTransfer.toString()]
            );
            const userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [mockToken.address,0,txnData],
                userSA.address,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );
            const provider = entryPoint?.provider;
            const chainId = await provider!.getNetwork().then((net) => net.chainId);
            const invalidEntryPointAddress = bob.address;
            const userOpHash = getUserOpHash(userOp,invalidEntryPointAddress,chainId);
            expect(await ecdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(SIG_VALIDATION_FAILED);
        });

        it("Returns SIG_VALIDATION_FAILED when userOp is signed by an invalid owner ", async()=>{
            const {ecdsaRegistryModule,entryPoint, userSA, mockToken} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("1.3425");

            let txnData = mockToken.interface.encodeFunctionData(
                "transfer",
                [bob.address,tokenAmountToTransfer.toString()]
            );

            const notSmartAccountOwner = charlie;
            const userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [mockToken.address,0,txnData],
                userSA.address,
                notSmartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );
            const provider = entryPoint?.provider;
            const chainId = await provider!.getNetwork().then((net) => net.chainId);
            const userOpHash = getUserOpHash(userOp,entryPoint.address,chainId);

            expect(await ecdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(SIG_VALIDATION_FAILED);
            await expect(entryPoint.handleOps([userOp],smartAccountOwner.address)).to.be.revertedWith("FailedOp");
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore);
        });

        it("Reverts when userOp.sender is an Unregistered Smart Account", async()=>{
            const {saFactory,ecdsaRegistryModule,ecdsaOwnershipSetupData, entryPoint, mockToken, userSA} = await setupTests();
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("1.9999");
            const EcdsaOwnershipRegistryModule = await hre.ethers.getContractFactory("EcdsaOwnershipRegistryModule");

            // get a new smart account
            const unregisteredSmartAccountAddress = await saFactory.getAddressForCounterFactualAccount(ecdsaRegistryModule.address,ecdsaOwnershipSetupData,smartAccountDeploymentIndex+1);
            await saFactory.deployCounterFactualAccount(ecdsaRegistryModule.address,ecdsaOwnershipSetupData,smartAccountDeploymentIndex+1);
            const unregisteredSA = await hre.ethers.getContractAt("SmartAccount", unregisteredSmartAccountAddress);

            //fund the smart account
            await mockToken.mint(unregisteredSmartAccountAddress, ethers.utils.parseEther("1000").toString());
            await deployer.sendTransaction({
                to: unregisteredSmartAccountAddress,
                value: ethers.utils.parseEther("60"),
            });

            //renounce ownership
            const renounceOwnershipUserOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [ecdsaRegistryModule.address, 0, EcdsaOwnershipRegistryModule.interface.encodeFunctionData("renounceOwnership",[])],
                unregisteredSmartAccountAddress,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );
            const handleOpsTx = await entryPoint.handleOps([renounceOwnershipUserOp],smartAccountOwner.address);
            await expect(handleOpsTx).to.not.emit(entryPoint, "UserOperationRevertReason");
            await expect(ecdsaRegistryModule.getOwner(unregisteredSA.address)).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");

            const sendTokenUserOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [mockToken.address, 0, encodeTransfer(bob.address,tokenAmountToTransfer.toString())],
                unregisteredSmartAccountAddress,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );
            
            const provider = entryPoint?.provider;
            const chainId = await provider!.getNetwork().then((net) => net.chainId);
            const userOpHash = getUserOpHash(sendTokenUserOp,entryPoint.address,chainId);
            await expect(ecdsaRegistryModule.validateUserOp(sendTokenUserOp,userOpHash)).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");
            
            const unregisteredSABalanceBefore = await mockToken.balanceOf(unregisteredSA.address);
            await expect(entryPoint.handleOps([sendTokenUserOp],smartAccountOwner.address)).to.be.revertedWith("FailedOp");
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
            expect(await mockToken.balanceOf(unregisteredSA.address)).to.equal(unregisteredSABalanceBefore);
        });

        it("Reverts when length of user.signature is less than 65 ", async()=>{
            const {ecdsaRegistryModule, entryPoint, mockToken, userSA} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("3.632");

            let txnData = await mockToken.interface.encodeFunctionData(
                "transfer",
                [bob.address,tokenAmountToTransfer.toString()]
            );

            const userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [mockToken.address,0,txnData],
                userSA.address,
                smartAccountOwner,
                entryPoint,
                ecdsaRegistryModule.address
            );
            const provider = entryPoint?.provider;
            const chainId = await provider!.getNetwork().then((net) => net.chainId);
            const userOpHash = await getUserOpHash(userOp,entryPoint.address,chainId);

            // construct signature of length < 65
            const invalidSignature = new Uint8Array(64);
            for (let i = 0; i < invalidSignature.length; i++) {
                invalidSignature[i] = i; // Set each byte to its index value
            }

            let invalidSignatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
                ["bytes", "address"],
                [invalidSignature, ecdsaRegistryModule.address]
            );
            userOp.signature = invalidSignatureWithModuleAddress;

            await expect(ecdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.revertedWith("WrongSignatureLength");
            await expect(entryPoint.handleOps([userOp],smartAccountOwner.address)).to.be.reverted;
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore);
        });
    });

    describe("isValidSignatureForAddress(): ", async()=>{
        it("Returns EIP1271_MAGIC_VALUE for valid signature signed by Smart Account Owner",async()=>{
            const {ecdsaRegistryModule, userSA} = await setupTests();

            const messageToSign = "SCW signed this message";
            const dataHash = hashMessage(messageToSign);
            const signature = await smartAccountOwner.signMessage(messageToSign);
            expect(await ecdsaRegistryModule.isValidSignatureForAddress(dataHash,signature,userSA.address)).to.equal(EIP1271_MAGIC_VALUE);
        });

        it("Reverts when Unregistered Smart Account calls isValidSignature()", async()=>{
            const {ecdsaRegistryModule, randomContract} = await setupTests();
            const unregisteredSmartAccount = randomContract.address;
            const messageToSign = "SCW signed this message";
            const dataHash = hashMessage(messageToSign);
            const signature = await smartAccountOwner.signMessage(messageToSign);

            // set msg.sender to be unregisteredSmartAccount instead of userSA.address
            await expect(ecdsaRegistryModule.isValidSignatureForAddress(dataHash,signature,unregisteredSmartAccount)).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");
        });

        it("Reverts when signature length is less than 65", async()=>{
            const {ecdsaRegistryModule, userSA} = await setupTests();

            const messageToSign = "SCW signed this message";
            const dataHash = hashMessage(messageToSign);
            // construct signature of length < 65
            const invalidSignature = new Uint8Array(64);
            for (let i = 0; i < invalidSignature.length; i++) {
                invalidSignature[i] = i; // Set each byte to its index value
            }
            await expect(ecdsaRegistryModule.isValidSignatureForAddress(dataHash,invalidSignature,userSA.address)).to.be.revertedWith("WrongSignatureLength");
        });

        it("Returns 0xffffffff for signatures not signed by Smart Account Owners ", async()=>{
            const {ecdsaRegistryModule, userSA} = await setupTests();

            const messageToSign = "SCW signed this message";
            const dataHash = hashMessage(messageToSign);
            const invalidOwner = charlie;
            const signature = await invalidOwner.signMessage(messageToSign);

            expect(await ecdsaRegistryModule.isValidSignatureForAddress(dataHash,signature,userSA.address)).to.equal(EIP1271_INVALID_SIGNATURE);
        });
    });
});
