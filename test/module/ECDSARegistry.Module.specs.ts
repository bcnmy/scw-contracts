import { expect } from "chai";
import hre , { ethers, deployments, waffle } from "hardhat";
import { AddressZero } from "../aa-core/testutils";
import { makeEcdsaModuleUserOp, getUserOpHash } from "../utils/userOp";
import {getEntryPoint,getSmartAccountFactory, getEcdsaOwnershipRegistryModule,deployContract, getMockToken} from "../utils/setupHelper";


describe("NEW::: ECDSA Registry Module: ", async()=>{

    const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();
    const smartAccountDeploymentIndex = 0;
    const SIG_VALIDATION_SUCCESS = 0;
    const SIG_VALIDATION_FAILED = 1;

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

        const expectedSmartAccountAddress = await saFactory.getAddressForCounterFactualAccount(ecdsaRegistryModule.address,ecdsaOwnershipSetupData,smartAccountDeploymentIndex);
        await saFactory.deployCounterFactualAccount(ecdsaRegistryModule.address,ecdsaOwnershipSetupData,smartAccountDeploymentIndex);
        const userSA = await hre.ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);

        const tokensToMint = ethers.utils.parseEther("100");
        await mockToken.mint(userSA.address,tokensToMint.toString());
        await mockToken.mint(bob.address,tokensToMint.toString());

        await deployer.sendTransaction({
            to: expectedSmartAccountAddress,
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
            expectedSmartAccountAddress: expectedSmartAccountAddress,
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

            // Add 1 to smartAccountDeploymentIndex because the prev index SA has already been deployed
            const expectedSmartAccountAddress = await saFactory.getAddressForCounterFactualAccount(ecdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex+1);
            await expect(saFactory.deployCounterFactualAccount(ecdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex+1)).to.revertedWith("NotEOA");
            expect( await ecdsaRegistryModule.smartAccountOwners(expectedSmartAccountAddress)).to.be.equal(AddressZero);
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

    describe("setOwner(): ",async()=>{
        it("Call setOwner() from userSA and it successfully changes owner ", async()=>{
            const {ecdsaRegistryModule,entryPoint,userSA} = await setupTests();
            // Calldata to set Bob as owner
            let txnData1 = ecdsaRegistryModule.interface.encodeFunctionData(
                "setOwner",
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
            expect(await ecdsaRegistryModule.smartAccountOwners(userSA.address)).to.be.equal(bob.address);
        });

        it("Reverts while setting Smart Contract Address as owner via setOwner() ", async()=>{
            const {ecdsaRegistryModule,entryPoint, randomContract, userSA} = await setupTests();
            const previousOwner = await ecdsaRegistryModule.smartAccountOwners(userSA.address);
            let txnData1 = ecdsaRegistryModule.interface.encodeFunctionData(
                "setOwner",
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
            expect(await ecdsaRegistryModule.smartAccountOwners(userSA.address)).to.be.equal(previousOwner);
        });
    });

    // validateUserOp(UserOperation calldata userOp,bytes32 userOpHash)
    describe("validateUserOp(): ", async()=>{

        it("Returns SIG_VALIDATION_SUCCESS for a valid UserOp and valid userOpHash ", async()=>{
            const {ecdsaRegistryModule,entryPoint,userSA,mockToken} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("50");

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
            const userOpHash = await getUserOpHash(userOp,entryPoint.address,chainId);

            expect(await ecdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(SIG_VALIDATION_SUCCESS);
            let tx = await entryPoint.handleOps([userOp],smartAccountOwner.address);
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore.add(tokenAmountToTransfer));
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore.sub(tokenAmountToTransfer));
        });

        // Pass in valid userOp with invalid userOpHash
        it("Returns SIG_VALIDATION_FAILED when invalid chainId is passed in userOpHash", async()=>{
            const {ecdsaRegistryModule, entryPoint, mockToken, userSA} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("50");

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
            const invalidChainId = 2* chainId;
            const invalidUserOpHash = await getUserOpHash(userOp,entryPoint.address,invalidChainId);

            expect(await ecdsaRegistryModule.validateUserOp(userOp,invalidUserOpHash)).to.be.equal(SIG_VALIDATION_FAILED);
            let tx = await entryPoint.handleOps([userOp],smartAccountOwner.address);
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore.add(tokenAmountToTransfer));
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore.sub(tokenAmountToTransfer));
        });

        it("Returns SIG_VALIDATION_FAILED when invalid entryPoint address is passed to userOpHash" ,async()=>{
            const {ecdsaRegistryModule, entryPoint, randomContract, userSA, mockToken} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("50");

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
            const invalidEntryPointAddress = bob.address;
            const userOpHash = await getUserOpHash(userOp,invalidEntryPointAddress,chainId);
            expect(await ecdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(SIG_VALIDATION_FAILED);

            let tx = await entryPoint.handleOps([userOp],smartAccountOwner.address);
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore.add(tokenAmountToTransfer));
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore.sub(tokenAmountToTransfer));
        });

        it("Returns SIG_VALIDATION_FAILED when userOp is by signed by invalid owner ", async()=>{
            const {ecdsaRegistryModule,entryPoint, userSA, mockToken} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("50");

            let txnData = await mockToken.interface.encodeFunctionData(
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
            const userOpHash = await getUserOpHash(userOp,entryPoint.address,chainId);

            expect(await ecdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(SIG_VALIDATION_FAILED);
            await expect(entryPoint.handleOps([userOp],smartAccountOwner.address)).to.be.revertedWith("FailedOp");
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore);
        });

        it("Reverts when userOp.sender is an Unregistered Smart Account", async()=>{
            const {saFactory,ecdsaRegistryModule,ecdsaOwnershipSetupData, entryPoint, mockToken, userSA} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("50");

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
            // get a new smart account address
            const unregisteredSmartAccount = await saFactory.getAddressForCounterFactualAccount(ecdsaRegistryModule.address,ecdsaOwnershipSetupData,smartAccountDeploymentIndex+1);
            userOp.sender = unregisteredSmartAccount;

            await expect(ecdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.revertedWith("NoOwnerRegisteredForSmartAccount");
            await expect(entryPoint.handleOps([userOp],smartAccountOwner.address)).to.be.reverted;
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore);
        });

        it("Reverts when length of user.signature is less than 65 ", async()=>{
            const {ecdsaRegistryModule, entryPoint, mockToken, userSA} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("50");

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

        it("Returns SIG_VALIDATION_FAILED when v is altered", async()=>{
            const {ecdsaRegistryModule, entryPoint, mockToken, userSA} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("50");

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

            // Decoding signature and alter "v"
            const abi = ["bytes", "address"];
            const [ decodedSignature, decodedAddress ] = ethers.utils.defaultAbiCoder.decode(abi,userOp.signature);

            let {v,r,s} = ethers.utils.splitSignature(decodedSignature);

            // v can attain 2 possible values
            // Switching v between those two
            // EIP-155 followed
            if(v>30){
                v = (v == 2* chainId + 35) ? 2* chainId + 36 : 2* chainId + 35;
            }
            else{
                v = (v == 27 )? 28 : 27;
            }

            const newSignature = ethers.utils.joinSignature({v,r,s});
            const invalidSignature = ethers.utils.defaultAbiCoder.encode(
                ["bytes", "address"],
                [newSignature, ecdsaRegistryModule.address]
            );
            userOp.signature = invalidSignature;

            expect(await ecdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(SIG_VALIDATION_FAILED);
            await expect(entryPoint.handleOps([userOp],smartAccountOwner.address)).to.be.reverted;
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore);
        });

        it("Reverts when r is altered", async()=>{
            const {ecdsaRegistryModule, entryPoint, randomContract, userSA, mockToken} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("50");

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

            // Decoding signature and alter "v"
            const abi = ["bytes", "address"];
            const [ decodedSignature, decodedAddress ] = ethers.utils.defaultAbiCoder.decode(abi,userOp.signature);
            let {v,r,s} = ethers.utils.splitSignature(decodedSignature);

            // Incrementing r by 1
            const incrementedR = ethers.BigNumber.from(r).add(1);
            const updatedR = incrementedR.toHexString();
            const newSignature = ethers.utils.joinSignature({v,r:updatedR,s});

            const invalidSignature = ethers.utils.defaultAbiCoder.encode(
                ["bytes", "address"],
                [newSignature, ecdsaRegistryModule.address]
            );
            userOp.signature = invalidSignature;

            await expect(ecdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.revertedWith("ECDSA: invalid signature");
            await expect(entryPoint.handleOps([userOp],smartAccountOwner.address)).to.be.reverted;
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore);
        });

        it("Returns SIG_VALIDATION_FAILED when s is altered", async()=>{
            const {ecdsaRegistryModule, entryPoint, mockToken, userSA} = await setupTests();
            const userSABalanceBefore = await mockToken.balanceOf(userSA.address);
            const bobBalanceBefore = await mockToken.balanceOf(bob.address);
            const tokenAmountToTransfer = ethers.utils.parseEther("50");

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

            // Decoding signature and alter "v"
            const abi = ["bytes", "address"];
            const [ decodedSignature, decodedAddress ] = ethers.utils.defaultAbiCoder.decode(abi,userOp.signature);
            let {v,r,s} = ethers.utils.splitSignature(decodedSignature);

            // Incrementing s by 1
            const incrementedS= ethers.BigNumber.from(s).add(1);
            const updatedS = incrementedS.toHexString();
            const newSignature = ethers.utils.joinSignature({v,r,s: updatedS});

            const invalidSignature = ethers.utils.defaultAbiCoder.encode(
                ["bytes", "address"],
                [newSignature, ecdsaRegistryModule.address]
            );
            userOp.signature = invalidSignature;

            expect(await ecdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(SIG_VALIDATION_FAILED);
            await expect(entryPoint.handleOps([userOp],smartAccountOwner.address)).to.be.reverted;
            expect(await mockToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);
            expect(await mockToken.balanceOf(userSA.address)).to.equal(userSABalanceBefore);
        });
    });
});
