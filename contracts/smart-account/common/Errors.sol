// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

contract BaseSmartAccountErrors {
    /**
     * @notice Throws at onlyEntryPoint when msg.sender is not an EntryPoint set for this Smart Account
     * @param caller address that tried to call onlyEntryPoint-protected method
     */
    error CallerIsNotAnEntryPoint(address caller);
}

contract FallbackManagerErrors {
    /**
     * @notice Throws if zero address has been provided as Fallback Handler address
     */
    error HandlerCannotBeZero();
}

contract ModuleManagerErrors {
    /**
     * @notice Throws when trying to initialize module manager that already been initialized
     */
    error ModulesAlreadyInitialized();

    /**
     * @notice Throws when a delegatecall in course of module manager initialization has failed
     */
    error ModulesSetupExecutionFailed();

    /**
     * @notice Throws when address(0) or SENTINEL_MODULES constant has been provided as a module address
     * @param module Module address provided
     */
    error ModuleCannotBeZeroOrSentinel(address module);

    /**
     * @notice Throws when trying to enable module that has already been enabled
     * @param module Module address provided
     */
    error ModuleAlreadyEnabled(address module);

    /**
     * @notice Throws when module and previous module mismatch
     * @param expectedModule expected module at modules[prevModule]
     * @param returnedModule the module that has been found at modules[prevModule]
     * @param prevModule previous module address provided at call
     */
    error ModuleAndPrevModuleMismatch(
        address expectedModule,
        address returnedModule,
        address prevModule
    );

    /**
     * @notice Throws when trying to execute transaction from module that is not enabled
     * @param module Module address provided
     */
    error ModuleNotEnabled(address module);

    /**
     * @notice Throws when data for executeBatchCall provided in wrong format (i.e. empty array or lengths mismatch)
     * @param destLength length of destination contracts array
     * @param valueLength length of txn values array
     * @param funcLength length of function signatures array
     * @param operationLength length of operation types array. 0 if there's no operations
     */
    error WrongBatchProvided(
        uint256 destLength,
        uint256 valueLength,
        uint256 funcLength,
        uint256 operationLength
    );
}

contract SmartAccountErrors is BaseSmartAccountErrors, ModuleManagerErrors {
    /**
     * @notice Throws if zero address has been provided as Entry Point address
     */
    error EntryPointCannotBeZero();

    /**
     * @notice Throws at mixedAuth when msg.sender is not an owner neither _self
     * @param caller address that tried to call mixedAuth-protected method
     */
    error MixedAuthFail(address caller);

    /**
     * @notice Throws if trying to change an owner of a SmartAccount to the zero address
     */
    error OwnerCannotBeZero();

    /**
     * @notice Throws if zero address has been provided as Base Implementation address
     */
    error BaseImplementationCannotBeZero();

    /**
     * @notice Throws if there is no code at implementationAddress
     * @param implementationAddress implementation address provided
     */
    error InvalidImplementation(address implementationAddress);

    /**
     * @notice Throws at onlyOwner when msg.sender is not an owner
     * @param caller address that tried to call onlyOwner method
     */
    error CallerIsNotOwner(address caller);

    /**
     * @notice Throws at _requireFromEntryPointOrOwner when msg.sender is not an EntryPoint neither an owner
     * @param caller address that tried to call _requireFromEntryPointOrOwner-protected method
     */
    error CallerIsNotEntryPointOrOwner(address caller);

    /**
     * @notice Throws at _requireFromEntryPointOrSelf when msg.sender is not an EntryPoint neither self
     * @param caller address that tried to call _requireFromEntryPointOrSelf-protected method
     */
    error CallerIsNotEntryPointOrSelf(address caller);

    /**
     * @notice Throws at _requireFromEntryPoint when msg.sender is not an EntryPoint
     * @param caller address that tried to call _requireFromEntryPoint-protected method
     */
    error CallerIsNotEntryPoint(address caller);

    /**
     * @notice Throws if trying to initialize a Smart Account that has already been initialized
     */
    error AlreadyInitialized();

    /**
     * @notice Throws if contract signature is provided in frong format
     * @param uintS s converted to uint256
     * @param contractSignatureLength length of a contract signature
     * @param signatureLength the whole signature length
     */
    error WrongContractSignatureFormat(
        uint256 uintS,
        uint256 contractSignatureLength,
        uint256 signatureLength
    );

    /**
     * @notice Throws if isValidSignature for the conrtact signature and data hash differs from EIP1271 Magic Value
     * @param contractSignature the contract signature that has been verified
     */
    error WrongContractSignature(bytes contractSignature);

    /**
     * @notice Throws when if trying to transfer to zero address
     */
    error TransferToZeroAddressAttempt();

    /**
     * @notice Throws when module address taken from signature is not enabled
     * @param moduleAddressProvided module address taken from signature
     */
    error WrongValidationModule(address moduleAddressProvided);

    /**
     * @notice Thrown when the function that must be called only via delegatecall is called directly
     */
    error DelegateCallsOnly();

    /**
     * @notice Thrown when trying to use address of the Smart Account as an owner for itself
     */
    error OwnerCanNotBeSelf();

    /**
     * @notice Thrown when trying to use current owner as a new owner in a _setOwner() call
     */
    error OwnerProvidedIsSame();
}

contract SmartAccountFactoryErrors is SmartAccountErrors {
    /**
     * @notice Throws when the new Proxy deployment fails
     * @param owner Owner of a Proxy (Smart Account)
     * @param index Deployment index
     */
    error ProxyDeploymentFailed(address owner, uint256 index);
}

contract SelfAuthorizedErrors {
    /**
     * @notice Throws when the caller is not address(this)
     * @param caller Caller address
     */
    error CallerIsNotSelf(address caller);
}

contract SingletonPaymasterErrors {
    /**
     * @notice Throws when the Entrypoint address provided is address(0)
     */
    error EntryPointCannotBeZero();

    /**
     * @notice Throws when the verifiying signer address provided is address(0)
     */
    error VerifyingSignerCannotBeZero();

    /**
     * @notice Throws when the paymaster address provided is address(0)
     */
    error PaymasterIdCannotBeZero();

    /**
     * @notice Throws when the 0 has been provided as deposit
     */
    error DepositCanNotBeZero();

    /**
     * @notice Throws when trying to withdraw to address(0)
     */
    error CanNotWithdrawToZeroAddress();

    /**
     * @notice Throws when trying to withdraw more than balance available
     * @param amountRequired required balance
     * @param currentBalance available balance
     */
    error InsufficientBalance(uint256 amountRequired, uint256 currentBalance);

    /**
     * @notice Throws when signature provided has invalid length
     * @param sigLength length oif the signature provided
     */
    error InvalidPaymasterSignatureLength(uint256 sigLength);
}

//
