// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

import {SelfAuthorized} from "../common/SelfAuthorized.sol";
import {Executor, Enum} from "./Executor.sol";
import {ModuleManagerErrors} from "../common/Errors.sol";

/// @title Module Manager - A contract that manages modules that can execute transactions via this contract
contract ModuleManager is SelfAuthorized, Executor, ModuleManagerErrors {
    address internal constant SENTINEL_MODULES = address(0x1);

    mapping(address => address) internal modules;

    // Events
    event EnabledModule(address module);
    event DisabledModule(address module);
    event ExecutionFromModuleSuccess(address indexed module);
    event ExecutionFromModuleFailure(address indexed module);

    /**
     * @dev Returns array of modules. Useful for a widget
     * @param start Start of the page.
     * @param pageSize Maximum number of modules that should be returned.
     * @return array Array of modules.
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
        address currentModule = modules[start];
        while (
            currentModule != address(0x0) &&
            currentModule != SENTINEL_MODULES &&
            moduleCount < pageSize
        ) {
            array[moduleCount] = currentModule;
            currentModule = modules[currentModule];
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
     * @dev Allows to add a module to the allowlist.
     * @notice This can only be done via a Safe transaction.
     * @notice Enables the module `module` for the Safe.
     * @param module Module to be allow-listed.
     */
    function enableModule(address module) public authorized {
        // Module address cannot be null or sentinel.
        if (module == address(0) || module == SENTINEL_MODULES)
            revert ModuleCannotBeZeroOrSentinel(module);
        // Module cannot be added twice.
        if (modules[module] != address(0)) revert ModuleAlreadyEnabled(module);
        modules[module] = modules[SENTINEL_MODULES];
        modules[SENTINEL_MODULES] = module;
        emit EnabledModule(module);
    }

    /**
     * @dev Allows to remove a module from the allowlist.
     * @notice This can only be done via a Safe transaction.
     * @notice Disables the module `module` for the Safe.
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
        if (modules[prevModule] != module)
            revert ModuleAndPrevModuleMismatch(
                module,
                modules[prevModule],
                prevModule
            );
        modules[prevModule] = modules[module];
        // review if we should delete the module or just set it to address(0)
        delete modules[module];
        // modules[module] = address(0);
        emit DisabledModule(module);
    }

    /**
     * @dev Allows a Module to execute a Safe transaction without any further confirmations.
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
        // Only whitelisted modules are allowed.
        if (msg.sender == SENTINEL_MODULES || modules[msg.sender] == address(0))
            revert ModuleNotEnabled(msg.sender);
        // Execute transaction without further confirmations.
        success = execute(to, value, data, operation, gasleft());
        if (success) emit ExecutionFromModuleSuccess(msg.sender);
        else emit ExecutionFromModuleFailure(msg.sender);
    }

    /**
     * @dev Allows a Module to execute a Safe transaction without any further confirmations and return data
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
     * @dev Returns if an module is enabled
     * @return True if the module is enabled
     */
    function isModuleEnabled(address module) public view returns (bool) {
        return SENTINEL_MODULES != module && modules[module] != address(0);
    }

    /**
     * @notice Setup function sets the initial storage of the contract.
     *         Optionally executes a delegate call to another contract to setup the modules.
     * @param to Optional destination address of call to execute.
     * @param data Optional data of call to execute.
     */
    function _setupModules(address to, bytes memory data) internal {
        if (modules[SENTINEL_MODULES] != address(0))
            revert ModulesAlreadyInitialized();
        modules[SENTINEL_MODULES] = SENTINEL_MODULES;
        if (to != address(0))
            if (!execute(to, 0, data, Enum.Operation.DelegateCall, gasleft()))
                // Setup has to complete successfully or transaction fails.
                revert ModulesSetupExecutionFailed();
    }

    uint256[24] private __gap;
}
