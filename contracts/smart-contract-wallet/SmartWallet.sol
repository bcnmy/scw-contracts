// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

//TODO
//review Base licensing
//https://spdx.org/licenses/

import "./libs/LibAddress.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
import "./libs/ECDSA.sol";
import "hardhat/console.sol";

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

    function getOwner() public view returns(address) {
        return owner;
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
        require(_owner != address(0),"Invalid owner");
        require(_entryPoint != address(0), "Invalid Entrypoint");
        owner = _owner;
        entryPoint = _entryPoint;
        if (_handler != address(0)) internalSetFallbackHandler(_handler);
        setupModules(address(0), bytes(""));
    }

    /**
     * @dev Returns the largest of two numbers.
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a : b;
    }

    // @review 2D nonces and args as default batchId 0 is always used
    // TODO : Update description
    // TODO : Add batchId and update in test cases, utils etc
    // Gnosis style transaction with optional repay in native tokens OR ERC20 
    /// @dev Allows to execute a Safe transaction confirmed by required number of owners and then pays the account that submitted the transaction.
    /// Note: The fees are always transferred, even if the user transaction fails.
    /// @param _tx Wallet transaction 
    /// @param batchId batchId key for 2D nonces
    /// @param refundInfo Required information for gas refunds
    /// @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
    function execTransaction(
        Transaction memory _tx,
        uint256 batchId,
        FeeRefund memory refundInfo,
        bytes memory signatures
    ) public payable virtual returns (bool success) {
        uint256 gasUsed = gasleft();
        bytes32 txHash;
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            bytes memory txHashData =
                encodeTransactionData(
                    // Transaction info
                    _tx,
                    // Payment info
                    refundInfo,
                    // Signature info
                    nonces[batchId]
                );
            // Increase nonce and execute transaction.
            // Default space aka batchId is 0
            nonces[batchId]++;
            txHash = keccak256(txHashData);
            checkSignatures(txHash, txHashData, signatures);
        }


        // We require some gas to emit the events (at least 2500) after the execution and some to perform code until the execution (500)
        // We also include the 1/64 in the check that is not send along with a call to counteract potential shortings because of EIP-150
        require(gasleft() >= max((_tx.targetTxGas * 64) / 63,_tx.targetTxGas + 2500) + 500, "BSA010");
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            // If the gasPrice is 0 we assume that nearly all available gas can be used (it is always more than targetTxGas)
            // We only substract 2500 (compared to the 3000 before) to ensure that the amount passed is still higher than targetTxGas
            success = execute(_tx.to, _tx.value, _tx.data, _tx.operation, refundInfo.gasPrice == 0 ? (gasleft() - 2500) : _tx.targetTxGas);
            // If no targetTxGas and no gasPrice was set (e.g. both are 0), then the internal tx is required to be successful
            // This makes it possible to use `estimateGas` without issues, as it searches for the minimum gas where the tx doesn't revert
            require(success || _tx.targetTxGas != 0 || refundInfo.gasPrice != 0, "BSA013");
            // We transfer the calculated tx costs to the tx.origin to avoid sending it to intermediate contracts that have made calls
            uint256 payment = 0;
            if (refundInfo.gasPrice > 0) {
                gasUsed = gasUsed - gasleft();
                console.log("Sending this to handle payment %s", gasUsed);
                payment = handlePayment(gasUsed, refundInfo.baseGas, refundInfo.gasPrice, refundInfo.gasToken, refundInfo.refundReceiver);
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
        uint256 startGas = gasleft();
        // solhint-disable-next-line avoid-tx-origin
        address payable receiver = refundReceiver == address(0) ? payable(tx.origin) : refundReceiver;
        if (gasToken == address(0)) {
            // For ETH we will only adjust the gas price to not be higher than the actual used gas price
            payment = (gasUsed + baseGas) * (gasPrice < tx.gasprice ? gasPrice : tx.gasprice);
            // Review: low level call value vs transfer
            (bool success,) = receiver.call{value: payment}("");
            require(success, "BSA011");
        } else {
            payment = (gasUsed + baseGas) * (gasPrice);
            require(transferToken(gasToken, receiver, payment), "BSA012");
        }
        console.log("handle payment full gas %s", startGas - gasleft());
    }

    function handlePaymentAndRevert(
        uint256 gasUsed,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver
    ) external returns (uint256) {
        uint256 startGas = gasleft();
        uint256 payment;
        // solhint-disable-next-line avoid-tx-origin
        address payable receiver = refundReceiver == address(0) ? payable(tx.origin) : refundReceiver;
        if (gasToken == address(0)) {
            // For ETH we will only adjust the gas price to not be higher than the actual used gas price
            payment = (gasUsed + baseGas) * (gasPrice < tx.gasprice ? gasPrice : tx.gasprice);
            // Review: low level call value vs transfer
            (bool success,) = receiver.call{value: payment}("");
            require(success, "BSA011");
        } else {
            payment = (gasUsed + baseGas) * (gasPrice);
            require(transferToken(gasToken, receiver, payment), "BSA012");
        }
        uint256 requiredGas = startGas - gasleft();
        console.log("handle payment revert method gas %s", requiredGas);
        // Convert response to string and return via error message
        revert(string(abi.encodePacked(requiredGas)));
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
    ) public virtual view {
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
                require(uint256(s) >= uint256(1) * 65, "BSA021");

                // Check that signature data pointer (s) is in bounds (points to the length of data -> 32 bytes)
                require(uint256(s) + 32 <= signatures.length, "BSA022");

                // Check if the contract signature is in bounds: start of data is s + 32 and end is start + signature length
                uint256 contractSignatureLen;
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    contractSignatureLen := mload(add(add(signatures, s), 0x20))
                }
                require(uint256(s) + 32 + contractSignatureLen <= signatures.length, "BSA023");

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

    /// review necessity for this method for estimating execute call
    /// @dev Allows to estimate a transaction.
    ///      This method is only meant for estimation purpose, therefore the call will always revert and encode the result in the revert data.
    ///      Since the `estimateGas` function includes refunds, call this method to get an estimated of the costs that are deducted from the safe with `execTransaction`
    /// @param to Destination address of Safe transaction.
    /// @param value Ether value of transaction.
    /// @param data Data payload of transaction.
    /// @param operation Operation type of transaction.
    /// @return Estimate without refunds and overhead fees (base transaction and payload data gas costs).
    function requiredTxGas(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation
    ) external returns (uint256) {
        uint256 startGas = gasleft();
        // We don't provide an error message here, as we use it to return the estimate
        require(execute(to, value, data, operation, gasleft()));
        uint256 requiredGas = startGas - gasleft();
        // Convert response to string and return via error message
        revert(string(abi.encodePacked(requiredGas)));
    }


    /// @dev Returns hash to be signed by owner.
    /// @param to Destination address.
    /// @param value Ether value.
    /// @param data Data payload.
    /// @param operation Operation type.
    /// @param targetTxGas Fas that should be used for the safe transaction.
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
        uint256 targetTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        uint256 _nonce
    ) public view returns (bytes32) {
        Transaction memory _tx = Transaction({
            to: to,
            value: value,
            data: data,
            operation: operation,
            targetTxGas: targetTxGas
        });
        FeeRefund memory refundInfo = FeeRefund({
            baseGas: baseGas,
            gasPrice: gasPrice,
            gasToken: gasToken,
            refundReceiver: refundReceiver
        });
        return keccak256(encodeTransactionData(_tx, refundInfo, _nonce));
    }


    /// @dev Returns the bytes that are hashed to be signed by owner.
    /// @param _tx Wallet transaction 
    /// @param refundInfo Required information for gas refunds
    /// @param _nonce Transaction nonce.
    /// @return Transaction hash bytes.
    function encodeTransactionData(
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        uint256 _nonce
    ) public view returns (bytes memory) {
        bytes32 safeTxHash =
            keccak256(
                abi.encode(
                    WALLET_TX_TYPEHASH,
                    _tx.to,
                    _tx.value,
                    keccak256(_tx.data),
                    _tx.operation,
                    _tx.targetTxGas,
                    refundInfo.baseGas,
                    refundInfo.gasPrice,
                    refundInfo.gasToken,
                    refundInfo.refundReceiver,
                    _nonce
                )
            );
        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeTxHash);
    }

    // Extra Utils
    
    // Review: low level call value vs transfer // dest.transfer(amount);
    function transfer(address payable dest, uint amount) external onlyOwner {
        require(dest != address(0), "this action will burn your funds");
        (bool success,) = dest.call{value:amount}("");
        require(success,"transfer failed");
    }

    function pullTokens(address token, address dest, uint256 amount) external onlyOwner {
        IERC20 tokenContract = IERC20(token);
        SafeERC20.safeTransfer(tokenContract, dest, amount);
    }

    function exec(address dest, uint value, bytes calldata func) external onlyOwner{
        _call(dest, value, func);
    }

    function execBatch(address[] calldata dest, bytes[] calldata func) external onlyOwner{
        require(dest.length == func.length, "wrong array lengths");
        for (uint i = 0; i < dest.length;) {
            _call(dest[i], 0, func[i]);
            unchecked {
                ++i;
            }
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
        //during construction, the "nonce" field hold the salt.
        // if we assert it is zero, then we allow only a single wallet per owner.
        if (userOp.initCode.length == 0) {
            _validateAndUpdateNonce(userOp);
        }
        _payPrefund(requiredPrefund);
    }

    // review nonce conflict with AA userOp nonce
    // userOp can omit nonce or have batchId as well!
    function _validateAndUpdateNonce(UserOperation calldata userOp) internal {
        require(nonces[0]++ == userOp.nonce, "wallet: invalid nonce");
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

    // Review
    // withdrawDepositTo
    // addDeposit
    // getDeposit
}