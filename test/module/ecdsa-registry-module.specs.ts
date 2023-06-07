import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";

import { AddressZero } from "../aa-core/testutils";

import {getEntryPoint,getSmartAccountFactory} from "../utils/setupHelper";


// Test cases for initForSmartAccount()

// 1] Deploy Smart Account userSA
//    Pass EOA to initSmartAccount()
//    in the same transaction for enabling with module
//    Check whether owner is set or not

// 2] Deploy Smart Account userSA
//    Pass smart contract address to initSmartAccount()
//    in the same transaction for enabling with module
//    Check the owner mapping
//    Check for revert hehehehehe

// 3] Deploy Smart Account userSA
//    Pass EOA to initSmartAccount()
//    in the same transaction for enabling with module
//    Check whether owner is set or not
//    Send call again to initSmartAccount() and check for revert AlreadyInitedForSmartAccount(msg.sender);

// Test cases for setOwner()
// Set alice as owner with initSmartAccount()
// Would need to construct userOp and send it to userOp for these test cases
// 1] Call setOwner() and set Bob as owner
//    Assert via public mappimg
// 2] Call setOwner() and set SC as owner
//    Check for revert via public mapping

// Test cases for validateUserOp()
// Main thing to test out here is the internal function _verifySignature() that it calls
// 1] Construct a valid userOp and check if it does not revert
//    Uses fillAndSign()
// 2] SCENARIOS FOR GENERATING WRONG SIGNATURE i.e. drilling the _verifySignature()

// Test cases for isValidSignatureForAddress()


describe("NEW::: ECDSA Registry Module: ", async()=>{

    const [deployer, smartAccountOwner, alice, bob, charlie, verifiedSigner] = waffle.provider.getWallets();

    const setupTests = deployments.createFixture( async( {deployments, getNamedAccounts} ) =>{
        await deployments.fixture();

        const smartAccountDeploymentIndex = 0;

        // Deploy EntryPoint
        // Deploy SmartAccountFactory
        // Deploy ECDSA Module



    });

});
