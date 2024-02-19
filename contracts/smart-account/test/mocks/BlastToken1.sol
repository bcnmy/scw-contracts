// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../interfaces/IBlast.sol";

contract BlastToken1 is ERC20 {
    address public constant BLAST = 0x4300000000000000000000000000000000000002;

    constructor() ERC20("TST1", "MockToken") {
        IBlast(BLAST).configureClaimableGas();
        IBlast(BLAST).configureClaimableYield();
    }

    receive() external payable {}

    function mint(address sender, uint256 amount) external {
        _mint(sender, amount);
    }

    function claimYield(address recipient, uint256 amount) external {
        //This function is public meaning anyone can claim the yield
        IBlast(BLAST).claimYield(address(this), recipient, amount);
    }

    function claimAllYield(address recipient) external {
        //This function is public meaning anyone can claim the yield
        IBlast(BLAST).claimAllYield(address(this), recipient);
    }

    /// @notice Claim all gas regardless of rate
    /// @param recipientOfGas The address to send the gas to
    function claimAllGas(address recipientOfGas) external {
        IBlast(BLAST).claimAllGas(address(this), recipientOfGas);
    }

    /// @notice Claim gas at a minimum rate
    /// @param recipientOfGas The address to send the gas to
    /// @param minClaimRateBips The minimum rate to claim gas at
    function claimGasAtMinClaimRate(
        address recipientOfGas,
        uint256 minClaimRateBips
    ) external {
        IBlast(BLAST).claimGasAtMinClaimRate(
            address(this),
            recipientOfGas,
            minClaimRateBips
        );
    }

    function readGasParams(
        address contractAddress
    )
        external
        view
        returns (
            uint256 etherSeconds,
            uint256 etherBalance,
            uint256 lastUpdated,
            GasMode
        )
    {
        return IBlast(BLAST).readGasParams(contractAddress);
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
}
