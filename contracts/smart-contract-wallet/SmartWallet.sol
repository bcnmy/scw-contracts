// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

//TODO
//review Base licensing
//https://spdx.org/licenses/

import "./libs/LibAddress.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IWallet.sol";
import "./common/Singleton.sol";
import "./storage/WalletStorage.sol";
import "./base/ModuleManager.sol";
import "./base/FallbackManager.sol";
import "./common/SignatureDecoder.sol";
// import "./common/Hooks.sol";
import "./common/SecuredTokenTransfer.sol";
import "./interfaces/ISignatureValidator.sol";
import "./interfaces/IERC165.sol";
import "./libs/SafeMath.sol";
import "./libs/ECDSA.sol";

// Hooks not made a base yet
contract SmartWallet is 
     Singleton,
     IWallet,
     IERC165,
     WalletStorage,
     ModuleManager,
     SignatureDecoder,
     SecuredTokenTransfer,
     ISignatureValidatorConstants,
     FallbackManager,
     Initializable     
    {
    using ECDSA for bytes32;
    using LibAddress for address;
    using SafeMath for uint256;

    event ImplementationUpdated(address newImplementation);
    event ExecutionFailure(bytes32 txHash, uint256 payment);
    event ExecutionSuccess(bytes32 txHash, uint256 payment);
    event EntryPointChanged(address oldEntryPoint, address newEntryPoint);
    event EOAChanged(address indexed _scw, address indexed _oldEOA, address indexed _newEOA);

    // modifiers
    // onlyOwner
    /**
     * @notice Throws if the sender is not an the owner.
     */
    modifier onlyOwner {
        require(msg.sender == owner, "Smart Account:: Sender is not authorized");
        _;
    }

    // onlyOwner OR self
    modifier mixedAuth {
    require(msg.sender == owner || msg.sender == address(this),"Only owner or self");
    _;
   }

    // @notice authorized modifier (onlySelf) is already inherited

    // Setters

    function setOwner(address _newOwner) external mixedAuth {
        require(_newOwner != address(0), "Smart Account:: new Signatory address cannot be zero");
        owner = _newOwner;
        emit EOAChanged(address(this),owner,_newOwner);
    }

    /**
     * @notice Updates the implementation of the base wallet
     * @param _implementation New wallet implementation
     */
    function updateImplementation(address _implementation) external mixedAuth {
        require(_implementation.isContract(), "INVALID_IMPLEMENTATION");
        _setImplementation(_implementation);
        emit ImplementationUpdated(_implementation);
    }

    function updateEntryPoint(address _entryPoint) external mixedAuth {
        require(_entryPoint != address(0), "Smart Account:: new entry point address cannot be zero");
        emit EntryPointChanged(entryPoint, _entryPoint);
        entryPoint = _entryPoint;
    }

    // Getters

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, getChainId(), this));
    }

    /// @dev Returns the chain id used by this contract.
    function getChainId() public view returns (uint256) {
        uint256 id;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            id := chainid()
        }
        return id;
    }

    /**
     * @dev returns a value from the nonces 2d mapping
     * @param batchId : the key of the user's batch being queried
     * @return nonce : the number of transaction made within said batch
     */
    function getNonce(uint256 batchId)
    public view
    returns (uint256) {
        return nonces[batchId];
    }
    
    // Initialize / Setup
    // Used to setup
    // i. owner ii. entry point iii. handlers
    function init(address _owner, address _entryPoint, address _handler) public initializer { 
        require(owner == address(0), "Already initialized");
        require(entryPoint == address(0), "Already initialized");
        owner = _owner;
        entryPoint = _entryPoint;
        if (_handler != address(0)) internalSetFallbackHandler(_handler);
        setupModules(address(0), bytes(""));
    }

    // @review 2D nonces and args as default batchId 0 is always used
    // TODO : Update description
    // TODO : Add batchId and update in test cases, utils etc
    // Gnosis style transaction with optional repay in native tokens OR ERC20 
    /// @dev Allows to execute a Safe transaction confirmed by required number of owners and then pays the account that submitted the transaction.
    /// Note: The fees are always transferred, even if the user transaction fails.
    /// @param to Destination address of Safe transaction.
    /// @param value Ether value of Safe transaction.
    /// @param data Data payload of Safe transaction.
    /// @param operation Operation type of Safe transaction.
    /// @param safeTxGas Gas that should be used for the Safe transaction.
    /// @param baseGas Gas costs that are independent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund)
    /// @param gasPrice Gas price that should be used for the payment calculation.
    /// @param gasToken Token address (or 0 if ETH) that is used for the payment.
    /// @param refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
    /// @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice, //gasPrice or tokenGasPrice
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) public payable virtual returns (bool success) {
        bytes32 txHash;
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            bytes memory txHashData =
                encodeTransactionData(
                    // Transaction info
                    to,
                    value,
                    data,
                    operation,
                    safeTxGas,
                    // Payment info
                    baseGas,
                    gasPrice,
                    gasToken,
                    refundReceiver,
                    // Signature info
                    nonces[0]
                );
            // Increase nonce and execute transaction.
            // Default space aka batchId is 0
            nonces[0]++;
            txHash = keccak256(txHashData);
            checkSignatures(txHash, txHashData, signatures);
        }


        // We require some gas to emit the events (at least 2500) after the execution and some to perform code until the execution (500)
        // We also include the 1/64 in the check that is not send along with a call to counteract potential shortings because of EIP-150
        require(gasleft() >= ((safeTxGas * 64) / 63).max(safeTxGas + 2500) + 500, "BSA010");
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            uint256 gasUsed = gasleft();
            // If the gasPrice is 0 we assume that nearly all available gas can be used (it is always more than safeTxGas)
            // We only substract 2500 (compared to the 3000 before) to ensure that the amount passed is still higher than safeTxGas
            success = execute(to, value, data, operation, gasPrice == 0 ? (gasleft() - 2500) : safeTxGas);
            gasUsed = gasUsed.sub(gasleft());
            // If no safeTxGas and no gasPrice was set (e.g. both are 0), then the internal tx is required to be successful
            // This makes it possible to use `estimateGas` without issues, as it searches for the minimum gas where the tx doesn't revert
            require(success || safeTxGas != 0 || gasPrice != 0, "BSA013");
            // We transfer the calculated tx costs to the tx.origin to avoid sending it to intermediate contracts that have made calls
            uint256 payment = 0;
            if (gasPrice > 0) {
                payment = handlePayment(gasUsed, baseGas, gasPrice, gasToken, refundReceiver);
            }
            if (success) emit ExecutionSuccess(txHash, payment);
            else emit ExecutionFailure(txHash, payment);
        }
    }

    function handlePayment(
        uint256 gasUsed,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver
    ) private returns (uint256 payment) {
        // solhint-disable-next-line avoid-tx-origin
        address payable receiver = refundReceiver == address(0) ? payable(tx.origin) : refundReceiver;
        if (gasToken == address(0)) {
            // For ETH we will only adjust the gas price to not be higher than the actual used gas price
            payment = gasUsed.add(baseGas).mul(gasPrice < tx.gasprice ? gasPrice : tx.gasprice);
            require(receiver.send(payment), "BSA011");
        } else {
            payment = gasUsed.add(baseGas).mul(gasPrice);
            require(transferToken(gasToken, receiver, payment), "BSA012");
        }
    }

    // @review
    /**
     * @dev Checks whether the signature provided is valid for the provided data, hash. Will revert otherwise.
     * @param dataHash Hash of the data (could be either a message hash or transaction hash)
     * @param signatures Signature data that should be verified. Can be ECDSA signature, contract signature (EIP-1271) or approved hash.
     */
    function checkSignatures(
        bytes32 dataHash,
        bytes memory data,
        bytes memory signatures
    ) public view {
        uint8 v;
        bytes32 r;
        bytes32 s;
        uint256 i = 0;
        address _signer;
        (v, r, s) = signatureSplit(signatures, i);
        // review if necessary v = 1
        // review sig verification from other wallets
        if(v == 0) {
            // If v is 0 then it is a contract signature
            // When handling contract signatures the address of the contract is encoded into r
            _signer = address(uint160(uint256(r)));

            // Check that signature data pointer (s) is not pointing inside the static part of the signatures bytes
                // This check is not completely accurate, since it is possible that more signatures than the threshold are send.
                // Here we only check that the pointer is not pointing inside the part that is being processed
                require(uint256(s) >= uint256(1).mul(65), "BSA021");

                // Check that signature data pointer (s) is in bounds (points to the length of data -> 32 bytes)
                require(uint256(s).add(32) <= signatures.length, "BSA022");

                // Check if the contract signature is in bounds: start of data is s + 32 and end is start + signature length
                uint256 contractSignatureLen;
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    contractSignatureLen := mload(add(add(signatures, s), 0x20))
                }
                require(uint256(s).add(32).add(contractSignatureLen) <= signatures.length, "BSA023");

                // Check signature
                bytes memory contractSignature;
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    // The signature data for contract signatures is appended to the concatenated signatures and the offset is stored in s
                    contractSignature := add(add(signatures, s), 0x20)
                }
                require(ISignatureValidator(_signer).isValidSignature(data, contractSignature) == EIP1271_MAGIC_VALUE, "BSA024");
        }
        else if(v > 30) {
            // If v > 30 then default va (27,28) has been adjusted for eth_sign flow
            // To support eth_sign and similar we adjust v and hash the messageHash with the Ethereum message prefix before applying ecrecover
            _signer = ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash)), v - 4, r, s);
            require(_signer == owner, "INVALID_SIGNATURE");
        } else {
            _signer = ecrecover(dataHash, v, r, s);
            require(_signer == owner, "INVALID_SIGNATURE");
        }
    }


    /// @dev Returns hash to be signed by owners.
    /// @param to Destination address.
    /// @param value Ether value.
    /// @param data Data payload.
    /// @param operation Operation type.
    /// @param safeTxGas Fas that should be used for the safe transaction.
    /// @param baseGas Gas costs for data used to trigger the safe transaction.
    /// @param gasPrice Maximum gas price that should be used for this transaction.
    /// @param gasToken Token address (or 0 if ETH) that is used for the payment.
    /// @param refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
    /// @param _nonce Transaction nonce.
    /// @return Transaction hash.
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) public view returns (bytes32) {
        return keccak256(encodeTransactionData(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, _nonce));
    }


    /// @dev Returns the bytes that are hashed to be signed by owner.
    /// @param to Destination address.
    /// @param value Ether value.
    /// @param data Data payload.
    /// @param operation Operation type.
    /// @param safeTxGas Gas that should be used for the safe transaction.
    /// @param baseGas Gas costs for that are independent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund)
    /// @param gasPrice Maximum gas price that should be used for this transaction.
    /// @param gasToken Token address (or 0 if ETH) that is used for the payment.
    /// @param refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
    /// @param _nonce Transaction nonce.
    /// @return Transaction hash bytes.
    function encodeTransactionData(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) public view returns (bytes memory) {
        bytes32 safeTxHash =
            keccak256(
                abi.encode(
                    SAFE_TX_TYPEHASH,
                    to,
                    value,
                    keccak256(data),
                    operation,
                    safeTxGas,
                    baseGas,
                    gasPrice,
                    gasToken,
                    refundReceiver,
                    _nonce
                )
            );
        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeTxHash);
    }

    // Extra Utils
    
    function transfer(address payable dest, uint amount) external onlyOwner {
        dest.transfer(amount);
    }

    function pullTokens(address token, address dest, uint256 amount) external onlyOwner {
        IERC20 tokenContract = IERC20(token);
        tokenContract.transfer(dest, amount);
    }

    function exec(address dest, uint value, bytes calldata func) external onlyOwner{
        _call(dest, value, func);
    }

    function execBatch(address[] calldata dest, bytes[] calldata func) external onlyOwner{
        require(dest.length == func.length, "wrong array lengths");
        for (uint i = 0; i < dest.length; i++) {
            _call(dest[i], 0, func[i]);
        }
    }

    // AA implementation
    function _call(address sender, uint value, bytes memory data) internal {
        // @review linter
        (bool success, bytes memory result) = sender.call{value : value}(data);
        if (!success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                revert(add(result,32), mload(result))
            }
        }
    }

    function _requireFromEntryPoint() internal view {
        require(msg.sender == address(entryPoint), "wallet: not from EntryPoint");
    }

    //called by entryPoint, only after validateUserOp succeeded.
    function execFromEntryPoint(address dest, uint value, bytes calldata func) external {
        _requireFromEntryPoint();
        _call(dest, value, func);
    }

    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, uint requiredPrefund) external override {
        _requireFromEntryPoint();
        _validateSignature(userOp, requestId);
        _validateAndIncrementNonce(userOp);
        _payPrefund(requiredPrefund);
    }

    // review nonce conflict with AA userOp nonce
    // userOp can omit nonce or have batchId as well!
    function _validateAndIncrementNonce(UserOperation calldata userOp) internal {
        //during construction, the "nonce" field hold the salt.
        // if we assert it is zero, then we allow only a single wallet per owner.
        if (userOp.initCode.length == 0) {
            require(nonces[0]++ == userOp.nonce, "wallet: invalid nonce");
        }
        // default batchId aka space 0 for any wallet
    }

    function _payPrefund(uint requiredPrefund) internal {
        if (requiredPrefund != 0) {
            //pay required prefund. make sure NOT to use the "gas" opcode, which is banned during validateUserOp
            // (and used by default by the "call")
            // @review linter
            (bool success,) = payable(msg.sender).call{value : requiredPrefund, gas : type(uint).max}("");
            (success);
            //ignore failure (its EntryPoint's job to verify, not wallet.)
        }
    }

    function _validateSignature(UserOperation calldata userOp, bytes32 requestId) internal view {
        bytes32 hash = requestId.toEthSignedMessageHash();
        require(owner == hash.recover(userOp.signature), "wallet: wrong signature");
    }

    
    /**
     * @notice Query if a contract implements an interface
     * @param interfaceId The interface identifier, as specified in ERC165
     * @return `true` if the contract implements `_interfaceID`
    */
    function supportsInterface(bytes4 interfaceId) external view virtual override returns (bool) {
        return interfaceId == type(IERC165).interfaceId; // 0x01ffc9a7
    }
    
}