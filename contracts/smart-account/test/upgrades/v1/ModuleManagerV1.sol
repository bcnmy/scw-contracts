// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

import {SelfAuthorized} from "../../../common/SelfAuthorized.sol";
import {Executor, Enum} from "../../../base/Executor.sol";
import {ModuleManagerErrorsV1} from "./ErrorsV1.sol";

/**
 * @title Module Manager - A contract that manages _modules that can execute transactions
 *        on behalf of the Smart Account via this contract.
 */
contract ModuleManagerV1 is SelfAuthorized, Executor, ModuleManagerErrorsV1 {
    address internal constant SENTINEL_MODULES = address(0x1);

    mapping(address => address) internal _modules;

    // Events
    event EnabledModule(address module);
    event DisabledModule(address module);
    event ExecutionFromModuleSuccess(address indexed module);
    event ExecutionFromModuleFailure(address indexed module);
    event ModuleTransaction(
        address module,
        address to,
        uint256 value,
        bytes data,
        Enum.Operation operation
    );

    /**
     * @dev Returns array of _modules. Useful for a widget
     * @param start Start of the page.
     * @param pageSize Maximum number of _modules that should be returned.
     * @return array Array of _modules.
     * @return next Start of the next page.
     */
    function getModulesPaginated(
        address start,
        uint256 pageSize
    ) external view returns (address[] memory array, address next) {
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
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(array, moduleCount)
        }
    }

    /**
     * @dev Adds a module to the allowlist.
     * @notice This can only be done via a wallet transaction.
     * @notice Enables the module `module` for the wallet.
     * @param module Module to be allow-listed.
     */
    function enableModule(address module) public authorized {
        // Module address cannot be null or sentinel.
        if (module == address(0) || module == SENTINEL_MODULES)
            revert ModuleCannotBeZeroOrSentinel(module);
        // Module cannot be added twice.
        if (_modules[module] != address(0)) revert ModuleAlreadyEnabled(module);
        _modules[module] = _modules[SENTINEL_MODULES];
        _modules[SENTINEL_MODULES] = module;
        emit EnabledModule(module);
    }

    /**
     * @dev Removes a module from the allowlist.
     * @notice This can only be done via a wallet transaction.
     * @notice Disables the module `module` for the wallet.
     * @param prevModule Module that pointed to the module to be removed in the linked list
     * @param module Module to be removed.
     */
    function disableModule(
        address prevModule,
        address module
    ) public authorized {
        // Validate module address and check that it corresponds to module index.
        if (module == address(0) || module == SENTINEL_MODULES)
            revert ModuleCannotBeZeroOrSentinel(module);
        if (_modules[prevModule] != module)
            revert ModuleAndPrevModuleMismatch(
                module,
                _modules[prevModule],
                prevModule
            );
        _modules[prevModule] = _modules[module];
        delete _modules[module];
        emit DisabledModule(module);
    }

    /**
     * @dev Allows a Module to execute a Smart Account transaction without any further confirmations.
     * @param to Destination address of module transaction.
     * @param value Ether value of module transaction.
     * @param data Data payload of module transaction.
     * @param operation Operation type of module transaction.
     */
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) public virtual returns (bool success) {
        // Only whitelisted _modules are allowed.
        if (
            msg.sender == SENTINEL_MODULES || _modules[msg.sender] == address(0)
        ) revert ModuleNotEnabled(msg.sender);
        // Execute transaction without further confirmations.
        success = execute(to, value, data, operation, gasleft());
        if (success) {
            emit ModuleTransaction(msg.sender, to, value, data, operation);
            emit ExecutionFromModuleSuccess(msg.sender);
        } else emit ExecutionFromModuleFailure(msg.sender);
    }

    /**
     * @dev Allows a Module to execute a wallet transaction without any further confirmations and returns data
     * @param to Destination address of module transaction.
     * @param value Ether value of module transaction.
     * @param data Data payload of module transaction.
     * @param operation Operation type of module transaction.
     */
    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) public returns (bool success, bytes memory returnData) {
        success = execTransactionFromModule(to, value, data, operation);
        // solhint-disable-next-line no-inline-assembly
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

    /**
     * @dev Returns if a module is enabled
     * @return True if the module is enabled
     */
    function isModuleEnabled(address module) public view returns (bool) {
        return SENTINEL_MODULES != module && _modules[module] != address(0);
    }

    /**
     * @notice Setup function sets the initial storage of the contract.
     *         Optionally executes a delegate call to another contract to setup the _modules.
     * @param to Optional destination address of call to execute.
     * @param data Optional data of call to execute.
     */
    function _setupModules(address to, bytes memory data) internal {
        if (_modules[SENTINEL_MODULES] != address(0))
            revert ModulesAlreadyInitialized();
        _modules[SENTINEL_MODULES] = SENTINEL_MODULES;
        if (to != address(0))
            if (!execute(to, 0, data, Enum.Operation.DelegateCall, gasleft()))
                // Setup has to complete successfully or transaction fails.
                revert ModulesSetupExecutionFailed();
    }

    uint256[24] private __gap;
}
