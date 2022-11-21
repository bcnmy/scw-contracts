// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;


/* solhint-disable reason-string */

import "../aa-4337/interfaces/IPaymaster.sol";
import "../aa-4337/interfaces/IEntryPoint.sol";

/**
 * Helper class for creating a paymaster.
 * provides helper methods for staking.
 * validates that the postOp is called only by the entryPoint
 */
abstract contract BasePaymaster is IPaymaster {


    IEntryPoint public entryPoint;

    /**
    Owner realted function are implemented in this function instead of inheriting Ownable contract from Openzepplin. 
    cause Ownable contract needs to be inherit and it requires this { BasePaymaster } contract to have constructor
    So that its constructor can be called but we are deploying this contract using factory pattern that means we 
    can't create constructor for this contract
     */

    // maintain owner address
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        require(owner == _msgSender(), "Ownable: caller is not the owner");
        _;
    }

    function setEntryPoint(IEntryPoint _entryPoint) public onlyOwner {
        require(address(_entryPoint) != address(0), "BasePaymaster: new entry point can not be zero address");
        entryPoint = _entryPoint;
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 requestId, uint256 maxCost) external virtual override returns (bytes memory context);

    function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) external override {
        _requireFromEntryPoint();
        _postOp(mode, context, actualGasCost);
    }

    /**
     * post-operation handler.
     * (verified to be called only through the entryPoint)
     * @dev if subclass returns a non-empty context from validatePaymasterUserOp, it must also implement this method.
     * @param mode enum with the following options:
     *      opSucceeded - user operation succeeded.
     *      opReverted  - user op reverted. still has to pay for gas.
     *      postOpReverted - user op succeeded, but caused postOp (in mode=opSucceeded) to revert.
     *                       Now this is the 2nd call, after user's op was deliberately reverted.
     * @param context - the context value returned by validatePaymasterUserOp
     * @param actualGasCost - actual gas used so far (without this postOp call).
     */
    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) internal virtual {
        (mode,context,actualGasCost); // unused params
        // subclass must override this method if validatePaymasterUserOp returns a context
        revert("must override");
    }


    /**
     * add stake for this paymaster.
     * This method can also carry eth value to add to the current stake.
     * @param extraUnstakeDelaySec - set the stake to the entrypoint's default unstakeDelay plus this value.
     */
    function addStake(uint32 extraUnstakeDelaySec) external payable onlyOwner {
        entryPoint.addStake{value : msg.value}(entryPoint.unstakeDelaySec() + extraUnstakeDelaySec);
    }

    /**
     * return current paymaster's deposit on the entryPoint.
     */
    function getDeposit() public view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    /**
     * unlock the stake, in order to withdraw it.
     * The paymaster can't serve requests once unlocked, until it calls addStake again
     */
    function unlockStake() external onlyOwner {
        entryPoint.unlockStake();
    }

    /**
     * withdraw the entire paymaster's stake.
     * stake must be unlocked first (and then wait for the unstakeDelay to be over)
     * @param withdrawAddress the address to send withdrawn value.
     */
    function withdrawStake(address payable withdrawAddress) external onlyOwner {
        entryPoint.withdrawStake(withdrawAddress);
    }

    /// validate the call is made from a valid entrypoint
    function _requireFromEntryPoint() internal virtual {
        require(_msgSender() == address(entryPoint));
    }
}