// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseSmartAccount, IEntryPoint, UserOperation} from "./BaseSmartAccount.sol";
import {ModuleManager} from "./base/ModuleManager.sol";
import {FallbackManager} from "./base/FallbackManager.sol";
import {LibAddress} from "./libs/LibAddress.sol";
import {ISignatureValidator} from "./interfaces/ISignatureValidator.sol";
import {IERC165} from "./interfaces/IERC165.sol";
import {SmartAccountErrors} from "./common/Errors.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IAuthorizationModule} from "./interfaces/IAuthorizationModule.sol";

/**
 * @title SmartAccount - EIP-4337 compatible smart contract wallet.
 * @dev This contract is the base for the Smart Account functionality.
 *         - It is ownerless by nature. UserOp and txns validation happens in Authorization Modules.
 *         - It provides the functionality to execute AA (EIP-4337) userOps. Gnosis style txns removed to a module.
 *         - It allows to receive and manage assets.
 *         - It is responsible for managing the modules and fallbacks.
 *         - The Smart Account can be extended with modules, such as Social Recovery, Session Key and others.
 * @author Chirag Titiya - <chirag@biconomy.io>, Filipp Makarov - <filipp.makarov@biconomy.io>
 */
contract SmartAccount is
    BaseSmartAccount,
    ModuleManager,
    FallbackManager,
    IERC165,
    SmartAccountErrors,
    ISignatureValidator
{
    using ECDSA for bytes32;
    using LibAddress for address;

    // Storage Version
    string public constant VERSION = "2.0.0";

    // Owner storage. Deprecated. Left for storage layout compatibility
    address public owner_deprecated;

    // changed to 2D nonce below
    // @notice there is no _nonce
    // Deprecated. Left for storage layout compatibility
    mapping(uint256 => uint256) public nonces_deprecated;

    // AA immutable storage
    IEntryPoint private immutable _entryPoint;
    address private immutable _self;

    // Events
    event ImplementationUpdated(
        address indexed oldImplementation,
        address indexed newImplementation
    );
    event SmartAccountReceivedNativeToken(
        address indexed sender,
        uint256 indexed value
    );

    /**
     * @dev Constructor that sets the entry point contract.
     *      modules[SENTINEL_MODULES] = SENTINEL_MODULES protects implementation from initialization
     * @param anEntryPoint The address of the entry point contract.
     */
    constructor(IEntryPoint anEntryPoint) {
        _self = address(this);
        if (address(anEntryPoint) == address(0))
            revert EntryPointCannotBeZero();
        _entryPoint = anEntryPoint;
        modules[SENTINEL_MODULES] = SENTINEL_MODULES;
    }

    /**
     * @dev This function allows entry point or SA itself to execute certain actions.
     * If the caller is not authorized, the function will revert with an error message.
     * @notice This function acts as modifier and is marked as internal to be be called
     * within the contract itself only.
     */
    function _requireFromEntryPointOrSelf() internal view {
        if (msg.sender != address(entryPoint()) && msg.sender != address(this))
            revert CallerIsNotEntryPointOrSelf(msg.sender);
    }

    /**
     * @dev This function allows entry point to execute certain actions.
     * If the caller is not authorized, the function will revert with an error message.
     * @notice This function acts as modifier and is marked as internal to be be called
     * within the contract itself only.
     */
    function _requireFromEntryPoint() internal view {
        if (msg.sender != address(entryPoint()))
            revert CallerIsNotEntryPoint(msg.sender);
    }

    /**
     * @notice All the new implementations MUST have this method!
     * @notice Updates the implementation of the base wallet
     * @param _implementation New wallet implementation
     */
    function updateImplementation(address _implementation) public virtual {
        _requireFromEntryPointOrSelf();
        require(_implementation != address(0), "Address cannot be zero");
        if (!_implementation.isContract())
            revert InvalidImplementation(_implementation);
        address oldImplementation;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            oldImplementation := sload(address())
            sstore(address(), _implementation)
        }
        emit ImplementationUpdated(oldImplementation, _implementation);
    }

    /// Getters
    /**
     * @dev Returns the address of the implementation contract associated with this contract.
     * @notice The implementation address is stored in the contract's storage slot with index 0.
     */
    function getImplementation()
        external
        view
        returns (address _implementation)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _implementation := sload(address())
        }
    }

    /**
     * @dev Returns the current entry point used by this account.
     * @return EntryPoint as an `IEntryPoint` interface.
     * @dev This function should be implemented by the subclass to return the current entry point used by this account.
     */
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    /**
     * @dev Initialize the Smart Account with required states
     * @param handler Default fallback handler provided in Smart Account
     * @param moduleSetupContract Contract, that setups initial auth module for this smart account. It can be a module factory or
     *                            a registry module that serves several smart accounts
     * @param moduleSetupData modules setup data (a standard calldata for the module setup contract)
     * @notice devs need to make sure it is only callable once by initializer or state check restrictions
     * @notice any further implementations that introduces a new state must have a reinit method
     * @notice reinitialization is not possible, as _initialSetupModules reverts if the account is already initialized
     *         which is when there is at least one enabled module
     */
    function init(
        address handler,
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) external virtual override returns (address) {
        if (
            modules[SENTINEL_MODULES] != address(0) ||
            getFallbackHandler() != address(0)
        ) revert AlreadyInitialized();
        _setFallbackHandler(handler);
        return _initialSetupModules(moduleSetupContract, moduleSetupData);
    }

    /**
     * @dev Execute a transaction (called by entryPoint)
     * @notice Name is optimized for this method to be cheaper to be called
     * @param dest Address of the contract to call
     * @param value Amount of native tokens to send along with the transaction
     * @param func Data of the transaction
     */
    function executeCall_s1m(
        address dest,
        uint256 value,
        bytes calldata func
    ) public {
        _requireFromEntryPoint();
        _call(dest, value, func);
    }

    /**
     * @dev Interface function with the standard name for executeCall_s1m
     * @param dest Address of the contract to call
     * @param value Amount of native tokens to send along with the transaction
     * @param func Data of the transaction
     */
    function executeCall(
        address dest,
        uint256 value,
        bytes calldata func
    ) external {
        executeCall_s1m(dest, value, func);
    }

    /**
     * @dev Execute a sequence of transactions
     * @notice Name is optimized for this method to be cheaper to be called
     * @param dest Addresses of the contracts to call
     * @param value Amounts of native tokens to send along with the transactions
     * @param func Data of the transactions
     */
    function executeBatchCall_4by(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) public {
        _requireFromEntryPoint();
        if (
            dest.length == 0 ||
            dest.length != value.length ||
            value.length != func.length
        ) revert WrongBatchProvided(dest.length, value.length, func.length, 0);
        for (uint256 i; i < dest.length; ) {
            _call(dest[i], value[i], func[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Interface function with the standard name for executeBatchCall_4by
     * @param dest Addresses of the contracts to call
     * @param value Amounts of native tokens to send along with the transactions
     * @param func Data of the transactions
     */
    function executeBatchCall(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external {
        executeBatchCall_4by(dest, value, func);
    }

    /**
     * @dev internal method that fecilitates the extenral calls from SmartAccount
     * @dev similar to execute() of Executor.sol
     * @param target destination address contract/non-contract
     * @param value amount of native tokens
     * @param data function singature of destination
     */
    function _call(address target, uint256 value, bytes memory data) internal {
        assembly {
            let success := call(
                gas(),
                target,
                value,
                add(data, 0x20),
                mload(data),
                0,
                0
            )
            let ptr := mload(0x40)
            returndatacopy(ptr, 0, returndatasize())
            if iszero(success) {
                revert(ptr, returndatasize())
            }
        }
    }

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external virtual override returns (uint256 validationData) {
        if (msg.sender != address(entryPoint()))
            revert CallerIsNotAnEntryPoint(msg.sender);

        (, address validationModule) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        if (address(modules[validationModule]) != address(0)) {
            validationData = IAuthorizationModule(validationModule)
                .validateUserOp(userOp, userOpHash);
        } else {
            revert WrongValidationModule(validationModule);
        }
        _validateNonce(userOp.nonce);
        _payPrefund(missingAccountFunds);
    }

    /**
     * Implementation of ISignatureValidator (see `interfaces/ISignatureValidator.sol`)
     * @dev Forwards the validation to the module specified in the signature
     * @param dataHash 32 bytes hash of the data signed on the behalf of address(msg.sender)
     * @param signature Signature byte array associated with dataHash
     * @return bytes4 value.
     */
    function isValidSignature(
        bytes32 dataHash,
        bytes memory signature
    ) public view override returns (bytes4) {
        (bytes memory moduleSignature, address validationModule) = abi.decode(
            signature,
            (bytes, address)
        );
        if (address(modules[validationModule]) != address(0)) {
            return
                ISignatureValidator(validationModule).isValidSignature(
                    dataHash,
                    moduleSignature
                );
        } else {
            revert WrongValidationModule(validationModule);
        }
    }

    /**
     * @dev Check current account deposit in the entryPoint
     */
    function getDeposit() public view returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    /**
     * @dev Deposit more funds for this account in the entryPoint
     */
    function addDeposit() public payable {
        entryPoint().depositTo{value: msg.value}(address(this));
    }

    /**
     * @dev Withdraw value from the account's deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawDepositTo(
        address payable withdrawAddress,
        uint256 amount
    ) public payable {
        _requireFromEntryPointOrSelf();
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    /**
     * @dev Adds a module to the allowlist.
     * @notice This can only be done via a userOp or a selfcall.
     * @notice Enables the module `module` for the wallet.
     * @param module Module to be allow-listed.
     */
    function enableModule(address module) external virtual override {
        _requireFromEntryPointOrSelf();
        _enableModule(module);
    }

    /**
     * @dev Setups module for this Smart Account and enables it.
     * @notice This can only be done via userOp or a selfcall.
     * @notice Enables the module `module` for the wallet.
     */
    function setupAndEnableModule(
        address setupContract,
        bytes memory setupData
    ) external virtual override returns (address) {
        _requireFromEntryPointOrSelf();
        return _setupAndEnableModule(setupContract, setupData);
    }

    /**
     * @dev Removes a module from the allowlist.
     * @notice This can only be done via a wallet transaction.
     * @notice Disables the module `module` for the wallet.
     * @param prevModule Module that pointed to the module to be removed in the linked list
     * @param module Module to be removed.
     */
    function disableModule(address prevModule, address module) public virtual {
        _requireFromEntryPointOrSelf();
        _disableModule(prevModule, module);
    }

    /**
     * @dev Sets the fallback handler.
     * @notice This can only be done via a UserOp sent by EntryPoint.
     * @param handler Handler to be set.
     */
    function setFallbackHandler(address handler) external virtual override {
        _requireFromEntryPointOrSelf();
        _setFallbackHandler(handler);
    }

    /**
     * @notice Query if a contract implements an interface
     * @param _interfaceId The interface identifier, as specified in ERC165
     * @return `true` if the contract implements `_interfaceID`
     */
    function supportsInterface(
        bytes4 _interfaceId
    ) external view virtual override returns (bool) {
        return _interfaceId == type(IERC165).interfaceId; // 0x01ffc9a7
    }

    /**
     * @dev This function is a special fallback function that is triggered when the contract receives Ether.
     * It logs an event indicating the amount of Ether received and the sender's address.
     * @notice This function is marked as external and payable, meaning it can be called from external
     * sources and accepts Ether as payment.
     */
    receive() external payable {
        if (address(this) == _self) revert DelegateCallsOnly();
        emit SmartAccountReceivedNativeToken(msg.sender, msg.value);
    }
}
