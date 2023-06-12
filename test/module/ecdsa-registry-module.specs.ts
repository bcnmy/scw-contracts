import { expect } from "chai";
import hre , { ethers, deployments, waffle } from "hardhat";
import { AddressZero } from "../aa-core/testutils";
import { makeEcdsaModuleUserOp, makeEcdsaModuleUserOpWithPaymaster, fillAndSign, getUserOpHash } from "../utils/userOp";
import {getEntryPoint,getSmartAccountFactory, getEcdsaOwnershipRegistryModule,deployContract} from "../utils/setupHelper";
import { EntryPoint } from "../../typechain";
import { keccak256, arrayify } from "ethers/lib/utils";

describe("NEW::: ECDSA Registry Module: ", async()=>{

    const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();
    const smartAccountDeploymentIndex = 0;

    const setupTests = deployments.createFixture(async( {deployments, getNamedAccounts} ) =>{
        await deployments.fixture();

        // Deploy EntryPoint
        const entryPoint = await getEntryPoint();
        // Deploy SmartAccountFactory
        const SAFactory = await getSmartAccountFactory();
        // Deploy ECDSA Module
        const EcdsaRegistryModule = await getEcdsaOwnershipRegistryModule();

        return {
            entryPoint: entryPoint,
            SAFactory: SAFactory,
            EcdsaRegistryModule: EcdsaRegistryModule,
        };
    });

    // alice is the owner
    const setupTests1 = deployments.createFixture(async( {deployments, getNamedAccounts} ) =>{
        await deployments.fixture();

        // Deploy EntryPoint
        const entryPoint = await getEntryPoint();
        // Deploy SmartAccountFactory
        const SAFactory = await getSmartAccountFactory();
        // Deploy ECDSA Module
        const EcdsaRegistryModule = await getEcdsaOwnershipRegistryModule();

        let EcdsaOwnershipSetupData = EcdsaRegistryModule.interface.encodeFunctionData(
            "initForSmartAccount",
            [alice.address]
         );

         const expectedSmartAccountAddress = await SAFactory.getAddressForCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
         await SAFactory.deployCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
         const userSA = await hre.ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);

        await deployer.sendTransaction({
            to: userSA.address,
            value: ethers.utils.parseEther("10"),
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
            SAFactory: SAFactory,
            EcdsaRegistryModule: EcdsaRegistryModule,
            userSA: userSA,
            randomContract: randomContract
        };
    });



    describe("initForSmartAccount: ", async() =>{
        // Pass in EOA address in setupData for calling initForSmartAccount function and SA is succesfully deployed
        it("Setups ECDSA Module for the deployed Smart Account", async()=>{
            const {SAFactory,EcdsaRegistryModule} = await setupTests();

            let EcdsaOwnershipSetupData = EcdsaRegistryModule.interface.encodeFunctionData(
                "initForSmartAccount",
                [await smartAccountOwner.address]
              );

            const expectedSmartAccountAddress = await SAFactory.getAddressForCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
            await SAFactory.deployCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
            const userSA = await hre.ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);

            expect( await EcdsaRegistryModule.smartAccountOwners(userSA.address)).to.be.equal(smartAccountOwner.address);

        });

        // Pass in non(EOA) as owner in the setupData and check for revert
        it("Reverts when trying to set Smart Contract as owner of the Smart Account", async()=>{
            const {SAFactory,EcdsaRegistryModule} = await setupTests();

            const randomContractCode = `
            contract random {
                function returnAddress() public view returns(address){
                    return address(this);
                }
            }
            `;
            const randomContract = await deployContract(deployer,randomContractCode);


            let EcdsaOwnershipSetupData = EcdsaRegistryModule.interface.encodeFunctionData(
                "initForSmartAccount",
                [randomContract.address]
              );

            const expectedSmartAccountAddress = await SAFactory.getAddressForCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);

            await expect(SAFactory.deployCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex)).to.revertedWith("NotEOA");

            // smartAccountOwners mapping should point to address(0)
            expect( await EcdsaRegistryModule.smartAccountOwners(expectedSmartAccountAddress)).to.be.equal(AddressZero);
        });

        // Listen for AlreadyInitedForSmartAccount(msg.sender) error
        it("Reverts when calling again after initialization", async()=>{
            const {SAFactory,EcdsaRegistryModule,entryPoint} = await setupTests();

            let EcdsaOwnershipSetupData = EcdsaRegistryModule.interface.encodeFunctionData(
                "initForSmartAccount",
                [smartAccountOwner.address]
              );

            const expectedSmartAccountAddress = await SAFactory.getAddressForCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
            await SAFactory.deployCounterFactualAccount(EcdsaRegistryModule.address,EcdsaOwnershipSetupData,smartAccountDeploymentIndex);
            const userSA = await hre.ethers.getContractAt("SmartAccount", expectedSmartAccountAddress);

            await deployer.sendTransaction({
                to: userSA.address,
                value: ethers.utils.parseEther("10"),
            });

            const txnData1 = EcdsaRegistryModule.interface.encodeFunctionData(
                "initForSmartAccount",
                [bob.address],
            );

            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [EcdsaRegistryModule.address,0, txnData1],
                userSA.address,
                smartAccountOwner,
                entryPoint,
                EcdsaRegistryModule.address
            );

            const tx = await entryPoint.handleOps([userOp], alice.address);
            await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");
        });
    });

    describe("setOwner(): ",async()=>{

        // Positive case
        it("Call setOwner() from userSA and changes owner ", async()=>{
            const {SAFactory,EcdsaRegistryModule,entryPoint, userSA} = await setupTests1();

            // assert alice as the initial owner
            expect( await EcdsaRegistryModule.smartAccountOwners(userSA.address)).to.be.equal(alice.address);

            // Calldata to set Bob as owner
            let txnData1 = EcdsaRegistryModule.interface.encodeFunctionData(
                "setOwner",
                [bob.address]
            );

            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [EcdsaRegistryModule.address,0,txnData1],
                userSA.address,
                alice,
                entryPoint,
                EcdsaRegistryModule.address
            );

            const tx = await entryPoint.handleOps([userOp],charlie.address);
            await expect(tx).to.not.emit(entryPoint, "UserOperationRevertReason");

            expect( await EcdsaRegistryModule.smartAccountOwners(userSA.address)).to.be.equal(bob.address);

        });

        // Negative case
        it("Reverts while setting Smart Contract Address as owner via setOwner() ", async()=>{
            const {SAFactory,EcdsaRegistryModule,entryPoint, userSA, randomContract} = await setupTests1();

            // assert alice as the initial owner
            expect( await EcdsaRegistryModule.smartAccountOwners(userSA.address)).to.be.equal(alice.address);

            // Calldata to set Bob as owner
            let txnData1 = EcdsaRegistryModule.interface.encodeFunctionData(
                "setOwner",
                [randomContract.address]
            );

            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [EcdsaRegistryModule.address,0,txnData1],
                userSA.address,
                alice,
                entryPoint,
                EcdsaRegistryModule.address
            );

            const tx = await entryPoint.handleOps([userOp],charlie.address);
            await expect(tx).to.emit(entryPoint, "UserOperationRevertReason");

            expect( await EcdsaRegistryModule.smartAccountOwners(userSA.address)).to.be.equal(alice.address);
        });
    });


    // validateUserOp(UserOperation calldata userOp,bytes32 userOpHash)
    describe("validateUserOp(): ", async()=>{

        // Construct a valid userOp and check if it does not revert
        it("Returns 0  for a valid UserOp and valid userOpHash ", async()=>{
            const {SAFactory,EcdsaRegistryModule,entryPoint, userSA, randomContract} = await setupTests1();

            let txndata = randomContract.interface.encodeFunctionData(
                "returnAddress",
                [],
            );

            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [randomContract.address,0,txndata],
                userSA.address,
                alice,
                entryPoint,
                EcdsaRegistryModule.address
            );

            // getChainId()
            const provider = entryPoint?.provider;
            const chainId = await provider!.getNetwork().then((net) => net.chainId);

            const userOpHash = await getUserOpHash(userOp,entryPoint.address,chainId);

            expect(await EcdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(0);
        });

        // Negative Cases

        // Pass in valid userOp with invalid userOpHash
        it("Returns SIG_VALIDATION_FAILED when invalid chainId is passed wrong chainId in userOpHash ", async()=>{
            const {SAFactory,EcdsaRegistryModule,entryPoint, userSA, randomContract} = await setupTests1();

            let txndata = randomContract.interface.encodeFunctionData(
                "returnAddress",
                [],
            );

            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [randomContract.address,0,txndata],
                userSA.address,
                alice,
                entryPoint,
                EcdsaRegistryModule.address
            );

            const provider = entryPoint?.provider;
            const chainId = await provider!.getNetwork().then((net) => net.chainId);
            const invalidChainId = 2* chainId;
            const userOpHash = await getUserOpHash(userOp,entryPoint.address,invalidChainId);

            expect(await EcdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(1);
        });

        it("Returns SIG_VALIDATION_FAILED when invalid entryPoint address is passed to userOpHash" ,async()=>{
            const {SAFactory,EcdsaRegistryModule,entryPoint, userSA, randomContract} = await setupTests1();

            let txndata = randomContract.interface.encodeFunctionData(
                "returnAddress",
                [],
            );

            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [randomContract.address,0,txndata],
                userSA.address,
                alice,
                entryPoint,
                EcdsaRegistryModule.address
            );

            const provider = entryPoint?.provider;
            const chainId = await provider!.getNetwork().then((net) => net.chainId);

            const userOpHash = await getUserOpHash(userOp,bob.address,chainId);
            expect(await EcdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(1);
        });

        // Sign userOp by

        it("Returns SIG_VALIDATION_FAILED when userOp by signed by invalid owner ", async()=>{
            const {SAFactory,EcdsaRegistryModule,entryPoint, userSA, randomContract} = await setupTests1();

            let txndata = randomContract.interface.encodeFunctionData(
                "returnAddress",
                [],
            );

            let userOp = await makeEcdsaModuleUserOp(
                "executeCall",
                [randomContract.address,0,txndata],
                userSA.address,
                bob,
                entryPoint,
                EcdsaRegistryModule.address
            );

            const provider = entryPoint?.provider;
            const chainId = await provider!.getNetwork().then((net) => net.chainId);

            const userOpHash = await getUserOpHash(userOp,entryPoint.address,chainId);
            expect(await EcdsaRegistryModule.validateUserOp(userOp,userOpHash)).to.be.equal(1);
        });
    });


    // Expects a hash prepended with 'x\x19Ethereum Signed Message:\n32'
    // isValidSignatureForAddress()
    // bytes32 dataHash, bytes memory signature, address smartAccount
    describe("isValidSignatureForAddress(): ", async()=>{
        // Deployed userSA in setupTests1() has alice as owner

        it("Returns EIP1271_MAGIC_VALUE when signed by owner of userSA ", async()=>{});

        it("Reverts when passed [bytes signature] of length<65 ", async()=>{});

        it("Reverts when passed invalid signature (invalid v,r,s) ", async()=>{});

    });

});
