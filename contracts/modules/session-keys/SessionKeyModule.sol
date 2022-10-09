// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../smart-contract-wallet/base/ModuleManager.sol";
import "./SignatureDecoder.sol";
import "../../smart-contract-wallet/common/Enum.sol";
// import "hardhat/console.sol";

contract SessionKeyModule is SignatureDecoder {
    string public constant NAME = "Session Key Module";
    string public constant VERSION = "0.1.0";

    struct TokenApproval {
        bool enable;
        uint256 amount;
    }

    struct TransferParams {
        bytes4 methodSignature;
        address to;
        uint256 amount;
    }

    // PermissionParam struct to be used as parameter in createSession method
    struct PermissionParam {
        address whitelistDestination;
        bytes4[] whitelistMethods;
        uint256 tokenAmount;
    }

    // SessionParam struct to be used as parameter in createSession method
    struct SessionParam {
        uint256 startTimestamp;
        uint256 endTimestamp;
        bool enable;
    }

    struct SessionResponse {
        uint256 startTimestamp;
        uint256 endTimestamp;
        bool enable;
        uint256 nonce;
    }

    struct PermissionStorage {
        address[] whitelistDestinations;
        mapping(address => bool) whitelistDestinationMap;
        mapping(address => bytes4[]) whitelistMethods;
        mapping(address => mapping(bytes4 => bool)) whitelistMethodsMap;
        mapping(address => TokenApproval) tokenApprovals;
    }

    struct Session {
        address smartAccount;
        address sessionKey;
        uint256 startTimestamp;
        uint256 nonce;
        uint256 endTimestamp;
        bool enable;
        PermissionStorage permission;
    }

    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH =
        keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");
    bytes32 public constant ALLOWANCE_TRANSFER_TYPEHASH =
        keccak256(
            "SessionTransaction(address to,uint256 amount,bytes data,uint256 nonce)"
        );

    mapping(address => Session) internal sessionMap;

    function createSession(
        address sessionKey,
        PermissionParam[] calldata permissions,
        SessionParam calldata sessionParam
    ) external {
        require(
            !sessionMap[sessionKey].enable,
            "Session for key is already enabled"
        );
        Session storage _session = sessionMap[sessionKey];
        _session.enable = true;
        _session.nonce = 0;
        _session.startTimestamp = sessionParam.startTimestamp;
        _session.endTimestamp = sessionParam.endTimestamp;
        _session.sessionKey = sessionKey;
        _session.smartAccount = msg.sender;

        address[] memory whitelistAddresses = new address[](permissions.length);
        for (uint256 index = 0; index < permissions.length; index++) {
            PermissionParam memory permission = permissions[index];
            address whitelistedDestination = permission.whitelistDestination;
            whitelistAddresses[index] = whitelistedDestination;
            _session.permission.whitelistDestinationMap[
                whitelistedDestination
            ] = true;

            _session.permission.whitelistMethods[
                whitelistedDestination
            ] = permission.whitelistMethods;

            for (
                uint256 methodIndex = 0;
                methodIndex < permission.whitelistMethods.length;
                methodIndex++
            ) {
                _session.permission.whitelistMethodsMap[whitelistedDestination][
                        permission.whitelistMethods[methodIndex]
                    ] = true;
            }

            if (permission.tokenAmount > 0) {
                _session.permission.tokenApprovals[
                    whitelistedDestination
                ] = TokenApproval({
                    enable: true,
                    amount: permission.tokenAmount
                });
            }
        }
        _session.permission.whitelistDestinations = whitelistAddresses;
    }

    function getSessionInfo(address sessionKey)
        public
        view
        returns (SessionResponse memory sessionInfo)
    {
        Session storage session = sessionMap[sessionKey];
        sessionInfo = SessionResponse({
            startTimestamp: session.startTimestamp,
            endTimestamp: session.endTimestamp,
            enable: session.enable,
            nonce: session.nonce
        });
    }

    function getWhitelistDestinations(address sessionKey)
        public
        view
        returns (address[] memory)
    {
        Session storage session = sessionMap[sessionKey];
        return session.permission.whitelistDestinations;
    }

    function getWhitelistMethods(
        address sessionKey,
        address whitelistDestination
    ) public view returns (bytes4[] memory) {
        Session storage session = sessionMap[sessionKey];
        return session.permission.whitelistMethods[whitelistDestination];
    }

    function getTokenPermissions(address sessionKey, address token)
        public
        view
        returns (TokenApproval memory tokenApproval)
    {
        Session storage session = sessionMap[sessionKey];
        return session.permission.tokenApprovals[token];
    }

    function getSelector(bytes calldata _data) public pure returns (bytes4) {
        bytes4 selector = bytes4(_data[0 : 4]);
        return selector;
    }

    function executeTransaction(
        address _sessionKey,
        address payable _to,
        uint256 _value,
        bytes calldata _data,
        bytes calldata signature
    ) external returns (bool success) {
        Session storage session = sessionMap[_sessionKey];
        require(session.enable, "Session is not active");
        require(
            session.startTimestamp <= block.timestamp,
            "Session has not yet started"
        );
        require(session.endTimestamp >= block.timestamp, "Session has expired");

        bytes memory transactionDataHash = generateTransactionHashData(
            _to,
            _value,
            _data,
            session.nonce
        );
        checkSignature(_sessionKey, signature, transactionDataHash);
        session.nonce += 1;

        require(
            session.permission.whitelistDestinationMap[_to],
            "Destination addres is not whitelisted"
        );

        bytes4 functionSelector = getSelector(_data);
        // console.log("function selector %s", functionSelector);

        require(
            session.permission.whitelistMethodsMap[_to][functionSelector],
            "Target method is not whitelisted"
        );

        // Check if function selector is of ERC20 transfer method
        if (functionSelector == bytes4(0xa9059cbb)) {
            (, uint256 amount) = decodeTransferData(_data);
            TokenApproval memory tokenApproval = session
                .permission
                .tokenApprovals[_to];
            require(
                tokenApproval.enable && tokenApproval.amount >= amount,
                "Approved amount less than current amount"
            );
        }

        // TODO: Check native value amount
        ModuleManager moduleManager = ModuleManager(session.smartAccount);
        return
            moduleManager.execTransactionFromModule(
                _to,
                _value,
                _data,
                Enum.Operation.Call
            );
    }

    function decodeTransferData(bytes calldata data)
        public
        pure
        returns (address to, uint256 amount)
    {
        (to, amount) = abi.decode(data[4:], (address, uint256));
    }

    function generateTransactionHashData(
        address payable _to,
        uint256 _amount,
        bytes memory _data,
        uint256 _nonce
    ) private view returns (bytes memory) {
        uint256 chainId = getChainId();
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_SEPARATOR_TYPEHASH, chainId, this)
        );
        bytes32 transferHash = keccak256(
            abi.encode(
                ALLOWANCE_TRANSFER_TYPEHASH,
                _to,
                _amount,
                keccak256(_data),
                _nonce
            )
        );
        return
            abi.encodePacked(
                bytes1(0x19),
                bytes1(0x01),
                domainSeparator,
                transferHash
            );
    }

    function getChainId() public view returns (uint256) {
        uint256 id;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            id := chainid()
        }
        return id;
    }

    function recoverSignature(
        bytes memory signature,
        bytes memory transferHashData
    ) private view returns (address owner) {
        // If there is no signature data msg.sender should be used
        if (signature.length == 0) return msg.sender;
        // Check that the provided signature data is as long as 1 encoded ecsda signature
        require(signature.length == 65, "signatures.length == 65");
        uint8 v;
        bytes32 r;
        bytes32 s;
        (v, r, s) = signatureSplit(signature, 0);
        // If v is 0 then it is a contract signature
        if (v == 0) {
            revert("Contract signatures are not supported by this module");
        } else if (v == 1) {
            // If v is 1 we also use msg.sender, this is so that we are compatible to the GnosisSafe signature scheme
            owner = msg.sender;
        } else if (v > 30) {
            // To support eth_sign and similar we adjust v and hash the transferHashData with the Ethereum message prefix before applying ecrecover
            owner = ecrecover(
                keccak256(
                    abi.encodePacked(
                        "\x19Ethereum Signed Message:\n32",
                        keccak256(transferHashData)
                    )
                ),
                v - 4,
                r,
                s
            );
        } else {
            // Use ecrecover with the messageHash for EOA signatures
            owner = ecrecover(keccak256(transferHashData), v, r, s);
        }
        // 0 for the recovered owner indicates that an error happened.
        require(owner != address(0), "owner != address(0)");
    }

    function checkSignature(
        address sessionKey,
        bytes memory signature,
        bytes memory transactionDataHash
    ) private view {
        address signer = recoverSignature(signature, transactionDataHash);
        require(signer == sessionKey, "Signature mismatch");
    }
}
