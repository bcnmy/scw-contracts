// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.23;

import {SelfAuthorized} from "../common/SelfAuthorized.sol";
import {Executor, Enum} from "./Executor.sol";
import {IModuleManager} from "../interfaces/base/IModuleManager.sol";

/**
 * @title Module Manager - A contract that manages modules that can execute transactions
 *        on behalf of the Smart Account via this contract.
 */
abstract contract ModuleManager is SelfAuthorized, Executor, IModuleManager {
    address internal constant SENTINEL_MODULES = address(0x1);
    mapping(address => address) internal _modules;
    uint256[24] private __gap;

    /// @inheritdoc IModuleManager
    function enableModule(address module) external virtual override;

    /// @inheritdoc IModuleManager
    function setupAndEnableModule(
        address setupContract,
        bytes memory setupData
    ) external virtual override returns (address);

    /// @inheritdoc IModuleManager
    function getModulesPaginated(
        address start,
        uint256 pageSize
    ) external view override returns (address[] memory array, address next) {
        // Init array with max page size
        array = new address[](pageSize);

        // Populate return array
        uint256 moduleCount;
        address currentModule = _modules[start];
        while (
            currentModule != address(0x0) &&
            currentModule != SENTINEL_MODULES &&
            moduleCount < pageSize
        ) {
            array[moduleCount] = currentModule;
            currentModule = _modules[currentModule];
            moduleCount++;
        }
        next = currentModule;
        // Set correct size of returned array

        assembly {
            mstore(array, moduleCount)
        }
    }

    /// @inheritdoc IModuleManager
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 txGas
    ) public virtual override returns (bool) {
        // Only whitelisted modules are allowed.
        if (
            msg.sender == SENTINEL_MODULES || _modules[msg.sender] == address(0)
        ) revert ModuleNotEnabled(msg.sender);
        // Execute transaction without further confirmations.
        // Can add guards here to allow delegatecalls for selected modules (msg.senders) only
        return
            _executeFromModule(
                to,
                value,
                data,
                operation,
                txGas == 0 ? gasleft() : txGas
            );
    }

    /// @inheritdoc IModuleManager
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) public virtual override returns (bool) {
        return execTransactionFromModule(to, value, data, operation, 0);
    }

    /// @inheritdoc IModuleManager
    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 txGas
    ) public override returns (bool success, bytes memory returnData) {
        success = execTransactionFromModule(to, value, data, operation, txGas);

        assembly {
            // Load free memory location
            let ptr := mload(0x40)
            // We allocate memory for the return data by setting the free memory location to
            // current free memory location + data size + 32 bytes for data size value
            mstore(0x40, add(ptr, add(returndatasize(), 0x20)))
            // Store the size
            mstore(ptr, returndatasize())
            // Store the data
            returndatacopy(add(ptr, 0x20), 0, returndatasize())
            // Point the return data to the correct memory location
            returnData := ptr
        }
    }

    /// @inheritdoc IModuleManager
    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) public override returns (bool, bytes memory) {
        return
            execTransactionFromModuleReturnData(to, value, data, operation, 0);
    }

    /// @inheritdoc IModuleManager
    function execBatchTransactionFromModule(
        address[] calldata to,
        uint256[] calldata value,
        bytes[] calldata data,
        Enum.Operation[] calldata operations
    ) public virtual override returns (bool success) {
        if (
            to.length == 0 ||
            to.length != value.length ||
            value.length != data.length ||
            data.length != operations.length
        ) {
            revert WrongBatchProvided(
                to.length,
                value.length,
                data.length,
                operations.length
            );
        }

        // Only whitelisted modules are allowed.
        if (
            msg.sender == SENTINEL_MODULES || _modules[msg.sender] == address(0)
        ) revert ModuleNotEnabled(msg.sender);

        for (uint256 i; i < to.length; ) {
            // Execute transaction without further confirmations.
            success = _executeFromModule(
                to[i],
                value[i],
                data[i],
                operations[i],
                gasleft()
            );
            unchecked {
                ++i;
            }
        }
    }

    /// @inheritdoc IModuleManager
    function isModuleEnabled(
        address module
    ) public view override returns (bool) {
        return SENTINEL_MODULES != module && _modules[module] != address(0);
    }

    /**
     * @dev Adds a module to the allowlist.
     * @notice This can only be done via a userOp or a selfcall.
     * @notice Enables the module `module` for the wallet.
     * @param module Module to be allow-listed.
     */
    function _enableModule(address module) internal virtual {
        // Module address cannot be null or sentinel.
        if (module == address(0) || module == SENTINEL_MODULES) {
            revert ModuleCanNotBeZeroOrSentinel(module);
        }
        // Module cannot be added twice.
        if (_modules[module] != address(0)) revert ModuleAlreadyEnabled(module);

        _modules[module] = _modules[SENTINEL_MODULES];
        _modules[SENTINEL_MODULES] = module;

        emit EnabledModule(module);
    }

    /**
     * @dev Setups module for this Smart Account and enables it.
     * @notice This can only be done via userOp or a selfcall.
     */
    function _setupAndEnableModule(
        address setupContract,
        bytes memory setupData
    ) internal virtual returns (address) {
        address module = _setupModule(setupContract, setupData);
        _enableModule(module);
        return module;
    }

    /**
     * @dev Removes a module from the allowlist.
     * Features the check, which does not allow removing the only enabled module.
     * Attention: If the only enabled module left IS NOT the validation (authorization) module,
     * the Smart Account won't be able to further validate userOps
     * thus it becomes frozen forever.
     * So please make sure there's always at least one validation (authorization) module enabled.
     * @notice This can only be done via a wallet transaction.
     * @notice Disables the module `module` for the wallet.
     * @param prevModule Module that pointed to the module to be removed in the linked list
     * @param module Module to be removed.
     */
    function _disableModule(
        address prevModule,
        address module
    ) internal virtual {
        // Validate module address and check that it corresponds to module index.
        if (module == address(0) || module == SENTINEL_MODULES) {
            revert ModuleCanNotBeZeroOrSentinel(module);
        }
        if (
            _modules[module] == SENTINEL_MODULES &&
            _modules[SENTINEL_MODULES] == module
        ) revert CanNotDisableOnlyModule(module);
        if (_modules[prevModule] != module) {
            revert ModuleAndPrevModuleMismatch(
                module,
                _modules[prevModule],
                prevModule
            );
        }
        _modules[prevModule] = _modules[module];
        delete _modules[module];
        emit DisabledModule(module);
    }

    /**
     * @notice Executes an operation from a module, emits specific events based on the result.
     * @param to The address to which the operation should be executed.
     * @param value The amount of ether (in wei) to send with the call (only for Call operations).
     * @param data The call data to send with the operation.
     * @param operation The type of operation to execute (either Call or DelegateCall).
     * @return success A boolean indicating whether the operation was successful.
     */
    function _executeFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 txGas
    ) internal returns (bool success) {
        success = _execute(to, value, data, operation, txGas);
        if (success) {
            emit ModuleTransaction(msg.sender, to, value, data, operation);
            emit ExecutionFromModuleSuccess(msg.sender);
        } else {
            emit ExecutionFromModuleFailure(msg.sender);
        }
    }

    /**
     * @notice Setup function sets the initial storage of the contract.
     * @param setupContract initializing the auth module; can be a module factory or a registry for multiple accounts.
     * @param setupData modules setup data (a standard calldata for the module setup contract)
     */
    function _initialSetupModules(
        address setupContract,
        bytes memory setupData
    ) internal virtual returns (address) {
        address initialAuthorizationModule = _setupModule(
            setupContract,
            setupData
        );

        // Module address cannot be null or sentinel.
        if (
            initialAuthorizationModule == address(0) ||
            initialAuthorizationModule == SENTINEL_MODULES
        ) {
            revert ModuleCanNotBeZeroOrSentinel(initialAuthorizationModule);
        }

        _modules[initialAuthorizationModule] = SENTINEL_MODULES;
        _modules[SENTINEL_MODULES] = initialAuthorizationModule;
        return initialAuthorizationModule;
    }

    /**
     * @notice Sets up a new module by calling a specified setup contract with provided data.
     *         The function will revert if the setupContract address is zero or if the setup call fails.
     * @dev This function is internal and utilizes assembly for low-level call operations and error handling.
     * @param setupContract The address of the contract that will be called to set up the module.
     * @param setupData The call data to send to the setup contract.
     * @return module The address of the newly set up module.
     */
    function _setupModule(
        address setupContract,
        bytes memory setupData
    ) internal returns (address module) {
        if (setupContract == address(0)) revert("Wrong Module Setup Address");
        assembly {
            let success := call(
                gas(),
                setupContract,
                0,
                add(setupData, 0x20),
                mload(setupData),
                0,
                0
            )
            let ptr := mload(0x40)
            returndatacopy(ptr, 0, returndatasize())
            if iszero(success) {
                revert(ptr, returndatasize())
            }
            module := mload(ptr)
        }
    }
}
