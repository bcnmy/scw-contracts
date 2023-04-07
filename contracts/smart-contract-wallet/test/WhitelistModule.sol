// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;
import "../SmartAccount.sol";
import {IModule} from "../interfaces/IModule.sol";

contract WhitelistModule {
    mapping(address => bool) public whitelisted;
    address public moduleOwner;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    // @review
    // Might as well keep a state to mark seen userOpHashes
    mapping(bytes32 => bool) public opsSeen;

    // @todo
    // Notice validateAndUpdateNonce in just skipped in case of modules. To avoid replay of same userOpHash I think it should be done.

    constructor(address _owner) {
        moduleOwner = _owner;
    }

    modifier onlyOwner() {
        require(msg.sender == moduleOwner, "sender not authorized");
        _;
    }

    function whitelistDestination(address payable _target) external onlyOwner {
        require(
            _target != address(0),
            "Destination target can not be zero address"
        );
        whitelisted[_target] = true;
    }

    /**
     * @dev standard validateSignature for modules to validate and mark userOpHash as seen
     * @param userOp the operation that is about to be executed.
     * @param userOpHash hash of the user's request data. can be used as the basis for signature.
     * @return sigValidationResult sigAuthorizer to be passed back to trusting Account, aligns with validationData
     */
    function validateSignature(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual returns (uint256 sigValidationResult) {
        if (opsSeen[userOpHash] == true) return SIG_VALIDATION_FAILED;
        opsSeen[userOpHash] = true;
        // can perform it's own access control logic, verify agaisnt expected signer and return SIG_VALIDATION_FAILED
        return 0;
    }

    function authCall(
        SmartAccount _account,
        address payable _to,
        uint96 _amount,
        bytes memory _data
    ) external {
        // Could have some access control from here like guardians!
        require(_to != address(0), "Target can not be zero address");
        require(
            whitelisted[_to] == true,
            "Unauthorized :: Target must be whitelised!"
        );
        require(
            _account.execTransactionFromModule(
                _to,
                _amount,
                _data,
                Enum.Operation.Call
            ),
            "Could not execute ether transfer"
        );
    }
}
