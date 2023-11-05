// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IAddressResolver {
    function getAddressForCounterFactualAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData,
        uint256 index
    ) external view returns (address _account);

    function getAddressForCounterFactualAccount(
        address _owner,
        uint256 _index
    ) external view returns (address _account);
}

interface IEcdsaRegistryModule {
    function initForSmartAccount(address eoaOwner) external returns (address);
}

interface ISmartAccount {
    function getImplementation()
        external
        view
        returns (address _implementation);

    function VERSION() external view returns (string memory);
}

contract AddressResolver {
     struct SmartAccountResult {
        address accountAddress;
        address factoryAddress;
        address currentImplementation;
        string currentVersion;
        string factoryVersion;
    }

    address public constant SA_V1_FACTORY =
        0x000000F9eE1842Bb72F6BBDD75E6D3d4e3e9594C;
    address public constant SA_V2_FACTORY =
        0x000000a56Aaca3e9a4C479ea6b6CD0DbcB6634F5;
    // marked for deletion
    address public constant SA_V1_IMPLEMENTATION =
        0x00006B7e42e01957dA540Dc6a8F7C30c4D816af5;
    // marked for deletion    
    address public constant SA_V2_IMPLEMENTATION =
        0x0000002512019Dafb59528B82CB92D3c5D2423aC;
    address public constant ECDSA_REGISTRY_MODULE_ADDRESS =
        0x0000001c5b32F37F5beA87BDD5374eB2aC54eA8e;

    // Todo Add natspec
    // Review could pass factory and module address in params
    function resolveEOAtoAccountAddresses(
        address _eoa,
        uint8 _maxIndex
    ) external view returns (SmartAccountResult[] memory) {
        SmartAccountResult[] memory _saInfo = new SmartAccountResult[](_maxIndex * 2);
        uint saInfoIndex = 0; // To keep track of the current index in _saAddresses

        for (uint i; i < _maxIndex; i++) {
            address v1Address = IAddressResolver(SA_V1_FACTORY)
                .getAddressForCounterFactualAccount(_eoa, i);
            if (v1Address != address(0) && _isSmartContract(v1Address)) {
                _saInfo[saInfoIndex] = SmartAccountResult(
                    v1Address,
                    SA_V1_FACTORY,
                    ISmartAccount(v1Address).getImplementation(),
                    ISmartAccount(v1Address).VERSION(),
                    "v1"
                );
                saInfoIndex++;
            }

            bytes4 selector = IEcdsaRegistryModule(
                ECDSA_REGISTRY_MODULE_ADDRESS
            ).initForSmartAccount.selector;
            bytes memory data = abi.encodeWithSelector(selector, _eoa);

            address v2Address = IAddressResolver(SA_V2_FACTORY)
                .getAddressForCounterFactualAccount(
                    ECDSA_REGISTRY_MODULE_ADDRESS,
                    data,
                    i
                );
            if (v2Address != address(0) && _isSmartContract(v2Address)) {
                _saInfo[saInfoIndex] = SmartAccountResult(
                    v2Address,
                    SA_V2_FACTORY,
                    ISmartAccount(v2Address).getImplementation(),
                    ISmartAccount(v2Address).VERSION(),
                    "v2"
                );
                saInfoIndex++;
            }
        }

        // Create a new dynamic array with only the used elements
        SmartAccountResult[] memory result = new SmartAccountResult[](saInfoIndex);
        for (uint j = 0; j < saInfoIndex; j++) {
            result[j] = _saInfo[j];
        }
        return result;
    }

    /**
     * @dev Checks if the address provided is a smart contract.
     * @param account Address to be checked.
     */
    function _isSmartContract(address account) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }
}
