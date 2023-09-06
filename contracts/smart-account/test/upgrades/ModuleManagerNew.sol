// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

import "../../common/Enum.sol";
import "../../common/SelfAuthorized.sol";
import "../../base/Executor.sol";

/// @title Module Manager - A contract that manages _modules that can execute transactions via this contract
contract ModuleManagerNew is SelfAuthorized, Executor {
    // Events
    event EnabledModule(address module);
    event DisabledModule(address module);
    event ExecutionFromModuleSuccess(address indexed module);
    event ExecutionFromModuleFailure(address indexed module);

    address internal constant SENTINEL_MODULES = address(0x1);
    bytes32 internal constant VERSION = "1.0.1";

    mapping(address => address) internal _modules;
    bool internal _isActive = true;

    function _setupModules(address to, bytes memory data) internal {
        require(_modules[SENTINEL_MODULES] == address(0), "BSA100");
        _modules[SENTINEL_MODULES] = SENTINEL_MODULES;
        if (to != address(0))
            // Setup has to complete successfully or transaction fails.
            require(
                execute(to, 0, data, Enum.Operation.DelegateCall, gasleft()),
                "BSA000"
            );
    }

    /// @dev Allows to add a module to the whitelist.
    ///      This can only be done via a wallet transaction.
    /// @notice Enables the module `module` for the wallet.
    /// @param module Module to be whitelisted.
    function enableModule(address module) public authorized {
        // Module address cannot be null or sentinel.
        require(module != address(0) && module != SENTINEL_MODULES, "BSA101");
        // Module cannot be added twice.
        require(_modules[module] == address(0), "BSA102");
        _modules[module] = _modules[SENTINEL_MODULES];
        _modules[SENTINEL_MODULES] = module;
        emit EnabledModule(module);
    }

    /// @dev Allows to remove a module from the whitelist.
    ///      This can only be done via a wallet transaction.
    /// @notice Disables the module `module` for the wallet.
    /// @param prevModule Module that pointed to the module to be removed in the linked list
    /// @param module Module to be removed.
    function disableModule(
        address prevModule,
        address module
    ) public authorized {
        // Validate module address and check that it corresponds to module index.
        require(module != address(0) && module != SENTINEL_MODULES, "BSA101");
        require(_modules[prevModule] == module, "BSA103");
        _modules[prevModule] = _modules[module];
        delete _modules[module];
        emit DisabledModule(module);
    }

    /// @dev Allows a Module to execute a wallet transaction without any further confirmations.
    /// @param to Destination address of module transaction.
    /// @param value Ether value of module transaction.
    /// @param data Data payload of module transaction.
    /// @param operation Operation type of module transaction.
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) public virtual returns (bool success) {
        require(_isActive == true, "disabled");
        // Only whitelisted _modules are allowed.
        require(
            msg.sender != SENTINEL_MODULES &&
                _modules[msg.sender] != address(0),
            "BSA104"
        );
        // Execute transaction without further confirmations.
        success = execute(to, value, data, operation, gasleft());
        if (success) emit ExecutionFromModuleSuccess(msg.sender);
        else emit ExecutionFromModuleFailure(msg.sender);
    }

    /// @dev Allows a Module to execute a wallet transaction without any further confirmations and return data
    /// @param to Destination address of module transaction.
    /// @param value Ether value of module transaction.
    /// @param data Data payload of module transaction.
    /// @param operation Operation type of module transaction.
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

    /// @dev Returns if an module is enabled
    /// @return True if the module is enabled
    function isModuleEnabled(address module) public view returns (bool) {
        return SENTINEL_MODULES != module && _modules[module] != address(0);
    }

    /// @dev Returns array of _modules. Useful for a widget
    /// @param start Start of the page.
    /// @param pageSize Maximum number of _modules that should be returned.
    /// @return array Array of _modules.
    /// @return next Start of the next page.
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

    // Must reduce the gap this way!
    uint256[23] private __gap;
}
