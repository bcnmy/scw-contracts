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

contract AddressResolver {
    struct SmartAccountResult {
        address accountAddress;
        address factoryAddress;
        string factoryVersion;
    }

    address public constant SA_V1_FACTORY =
        0x000000F9eE1842Bb72F6BBDD75E6D3d4e3e9594C;
    address public constant SA_V2_FACTORY =
        0x00000016FD385cEE5116EF68C189733679770338;
    address public constant SA_V1_IMPLEMENTATION =
        0x00006B7e42e01957dA540Dc6a8F7C30c4D816af5;
    address public constant SA_V2_IMPLEMENTATION =
        0x000000988555091db5633a5Be66d563EfB48cB95;
    address public constant ECDSA_REGISTRY_MODULE_ADDRESS =
        0x0000001c5b32F37F5beA87BDD5374eB2aC54eA8e;

    // Review returned information
    // Todo Add natspec
    function resolveEOAtoAccountAddresses(
        address _eoa,
        uint8 _maxIndex
    ) external view returns (address[] memory) {
        address[] memory _saAddresses = new address[](_maxIndex * 2);
        uint saAddressesIndex = 0; // To keep track of the current index in _saAddresses

        for (uint i; i < _maxIndex; i++) {
            address v1Address = IAddressResolver(SA_V1_FACTORY)
                .getAddressForCounterFactualAccount(_eoa, i);
            if (v1Address != address(0) && _isSmartContract(v1Address)) {
                _saAddresses[saAddressesIndex] = v1Address;
                saAddressesIndex++;
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
                _saAddresses[saAddressesIndex] = v2Address;
                saAddressesIndex++;
            }
        }

        // Create a new dynamic array with only the used elements
        address[] memory result = new address[](saAddressesIndex);
        for (uint j = 0; j < saAddressesIndex; j++) {
            result[j] = _saAddresses[j];
        }

        // Todo: instead of array of addresses return array of resolved result structs
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
