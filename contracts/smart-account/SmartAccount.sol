// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {BaseSmartAccount, IEntryPoint, UserOperation} from "./BaseSmartAccount.sol";
import {ModuleManager} from "./base/ModuleManager.sol";
import {FallbackManager} from "./base/FallbackManager.sol";
import {LibAddress} from "./libs/LibAddress.sol";
import {ISignatureValidator} from "./interfaces/ISignatureValidator.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IAuthorizationModule} from "./interfaces/IAuthorizationModule.sol";
import {ISmartAccount} from "./interfaces/ISmartAccount.sol";
import {IBaseSmartAccount} from "./interfaces/IBaseSmartAccount.sol";
import {IModuleManager} from "./interfaces/base/IModuleManager.sol";
import {IFallbackManager} from "./interfaces/base/IFallbackManager.sol";

/**
 * @title SmartAccount - EIP-4337 compatible smart contract wallet.
 * @dev This contract is the base for the Smart Account functionality.
 *         - It is modular by nature. UserOp and txns validation happens in Authorization Modules.
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
    ISmartAccount,
    ISignatureValidator
{
    using ECDSA for bytes32;
    using LibAddress for address;

    // Storage Version
    string public constant override VERSION = "2.0.0";

    // Owner storage. Deprecated. Left for storage layout compatibility
    address public ownerDeprecated;

    // changed to 2D nonce below
    // @notice there is no _nonce
    // Deprecated. Left for storage layout compatibility
    mapping(uint256 => uint256) public noncesDeprecated;

    // AA immutable storage
    IEntryPoint private immutable ENTRY_POINT;
    address private immutable SELF;

    /**
     * @dev Constructor that sets the entry point contract.
     *      _modules[SENTINEL_MODULES] = SENTINEL_MODULES protects implementation from initialization
     * @param anEntryPoint The address of the entry point contract.
     */
    constructor(IEntryPoint anEntryPoint) {
        SELF = address(this);
        if (address(anEntryPoint) == address(0)) {
            revert EntryPointCannotBeZero();
        }
        ENTRY_POINT = anEntryPoint;
        _modules[SENTINEL_MODULES] = SENTINEL_MODULES;
    }

    /**
     * @dev This function is a special fallback function that is triggered when the contract receives Ether.
     * It logs an event indicating the amount of Ether received and the sender's address.
     * @notice This function is marked as external and payable, meaning it can be called from external
     * sources and accepts Ether as payment.
     */
    receive() external payable {
        if (address(this) == SELF) revert DelegateCallsOnly();
        emit SmartAccountReceivedNativeToken(msg.sender, msg.value);
    }

    /// @inheritdoc ISmartAccount
    function init(
        address handler,
        address moduleSetupContract,
        bytes calldata moduleSetupData
    )
        external
        virtual
        override(ISmartAccount, BaseSmartAccount)
        returns (address)
    {
        if (
            _modules[SENTINEL_MODULES] != address(0) ||
            getFallbackHandler() != address(0)
        ) revert AlreadyInitialized();
        _setFallbackHandler(handler);
        return _initialSetupModules(moduleSetupContract, moduleSetupData);
    }

    /// @inheritdoc ISmartAccount
    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external override {
        execute_ncC(dest, value, func);
    }

    /// @inheritdoc ISmartAccount
    function executeBatch(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external override {
        executeBatch_y6U(dest, value, func);
    }

    /// @inheritdoc IBaseSmartAccount
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    )
        external
        virtual
        override(IBaseSmartAccount, BaseSmartAccount)
        returns (uint256 validationData)
    {
        if (msg.sender != address(entryPoint())) {
            revert CallerIsNotAnEntryPoint(msg.sender);
        }

        (, address validationModule) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        if (address(_modules[validationModule]) != address(0)) {
            validationData = IAuthorizationModule(validationModule)
                .validateUserOp(userOp, userOpHash);
        } else {
            revert WrongValidationModule(validationModule);
        }
        // Check nonce requirement if any
        _payPrefund(missingAccountFunds);
    }

    /// @inheritdoc IModuleManager
    function enableModule(
        address module
    ) external virtual override(IModuleManager, ModuleManager) {
        _requireFromEntryPointOrSelf();
        _enableModule(module);
    }

    /// @inheritdoc IModuleManager
    function setupAndEnableModule(
        address setupContract,
        bytes memory setupData
    )
        external
        virtual
        override(IModuleManager, ModuleManager)
        returns (address)
    {
        _requireFromEntryPointOrSelf();
        return _setupAndEnableModule(setupContract, setupData);
    }

    /// @inheritdoc IFallbackManager
    function setFallbackHandler(address handler) external virtual override {
        _requireFromEntryPointOrSelf();
        _setFallbackHandler(handler);
    }

    /// @inheritdoc ISmartAccount
    function getImplementation()
        external
        view
        override
        returns (address _implementation)
    {
        assembly {
            _implementation := sload(address())
        }
    }

    /// @inheritdoc IERC165
    function supportsInterface(
        bytes4 _interfaceId
    ) external view virtual override returns (bool) {
        return _interfaceId == type(IERC165).interfaceId; // 0x01ffc9a7
    }

    /// @inheritdoc ISmartAccount
    function updateImplementation(
        address _implementation
    ) public virtual override {
        _requireFromEntryPointOrSelf();
        require(_implementation != address(0), "Address cannot be zero");
        if (!_implementation.isContract()) {
            revert InvalidImplementation(_implementation);
        }
        address oldImplementation;

        assembly {
            oldImplementation := sload(address())
            sstore(address(), _implementation)
        }
        emit ImplementationUpdated(oldImplementation, _implementation);
    }

    /* solhint-disable func-name-mixedcase */

    /// @inheritdoc ISmartAccount
    function execute_ncC(
        address dest,
        uint256 value,
        bytes calldata func
    ) public override {
        _requireFromEntryPoint();
        _call(dest, value, func);
    }

    /// @inheritdoc ISmartAccount
    function executeBatch_y6U(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) public override {
        _requireFromEntryPoint();
        if (
            dest.length == 0 ||
            dest.length != value.length ||
            value.length != func.length
        ) {
            revert WrongBatchProvided(
                dest.length,
                value.length,
                func.length,
                0
            );
        }
        for (uint256 i; i < dest.length; ) {
            _call(dest[i], value[i], func[i]);
            unchecked {
                ++i;
            }
        }
    }

    /* solhint-enable func-name-mixedcase */

    /// @inheritdoc ISmartAccount
    function addDeposit() public payable override {
        entryPoint().depositTo{value: msg.value}(address(this));
    }

    /// @inheritdoc ISmartAccount
    function withdrawDepositTo(
        address payable withdrawAddress,
        uint256 amount
    ) public payable override {
        _requireFromEntryPointOrSelf();
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    /// @inheritdoc IModuleManager
    function disableModule(
        address prevModule,
        address module
    ) public virtual override {
        _requireFromEntryPointOrSelf();
        _disableModule(prevModule, module);
    }

    /// @inheritdoc BaseSmartAccount
    function entryPoint()
        public
        view
        virtual
        override(IBaseSmartAccount, BaseSmartAccount)
        returns (IEntryPoint)
    {
        return ENTRY_POINT;
    }

    /// @inheritdoc ISmartAccount
    function getDeposit() public view override returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignature(
        bytes32 dataHash,
        bytes memory signature
    ) public view override returns (bytes4) {
        (bytes memory moduleSignature, address validationModule) = abi.decode(
            signature,
            (bytes, address)
        );
        if (address(_modules[validationModule]) != address(0)) {
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

    /**
     * @dev This function allows entry point or SA itself to execute certain actions.
     * If the caller is not authorized, the function will revert with an error message.
     * @notice This function acts as modifier and is marked as internal to be be called
     * within the contract itself only.
     */
    function _requireFromEntryPointOrSelf() internal view {
        if (
            msg.sender != address(entryPoint()) && msg.sender != address(this)
        ) {
            revert CallerIsNotEntryPointOrSelf(msg.sender);
        }
    }

    /**
     * @dev This function allows entry point to execute certain actions.
     * If the caller is not authorized, the function will revert with an error message.
     * @notice This function acts as modifier and is marked as internal to be be called
     * within the contract itself only.
     */
    function _requireFromEntryPoint() internal view {
        if (msg.sender != address(entryPoint())) {
            revert CallerIsNotEntryPoint(msg.sender);
        }
    }
}
