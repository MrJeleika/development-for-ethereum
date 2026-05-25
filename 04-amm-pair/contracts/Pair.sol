// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Pair — pull-based constant-product AMM (x * y = k) for two ERC-20 tokens.
//
// This folds Uniswap V2's two layers into one: the Pair (core) and the Router
// (periphery). Real V2 keeps the Pair push-only (`swap(amount0Out,...)`) and
// puts the friendly pull logic in the Router. Here the pool pulls your tokens
// with transferFrom and computes outputs for you.
//
// The pair is itself an ERC-20: LP tokens track each provider's pool share.
//
// SKELETON: state, events, errors, the constructor, and the private math
// helpers are given. The four public functions are stubs for you to implement
// (see TASK.md for the formulas). Do not change the public signatures, event
// signatures, or error names — the reviewer matches on them.
contract Pair is ERC20 {
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    uint256 public reserve0;
    uint256 public reserve1;

    error InsufficientLiquidity();
    error InsufficientAmount();
    error InsufficientOutput(); // slippage: computed output < caller's minimum
    error InvalidToken();

    event LiquidityAdded(address indexed who, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed who, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Swapped(address indexed who, address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(IERC20 _token0, IERC20 _token1) ERC20("Simple AMM LP", "sLP") {
        token0 = _token0;
        token1 = _token1;
    }

    // ===================== implement these =====================

    // Pure fee math. See TASK.md for the exact formula and a worked example.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        revert("TODO: implement getAmountOut");
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 liquidity) {
        revert("TODO: implement addLiquidity");
    }

    function removeLiquidity(uint256 liquidity) external returns (uint256 amount0, uint256 amount1) {
        revert("TODO: implement removeLiquidity");
    }

    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut) {
        revert("TODO: implement swap");
    }

    // ===================== given: math helpers =====================

    // Reserves track the pool's accounting, separate from raw balances. Call
    // this after every transfer in/out to settle reserves to current balances.
    function _sync() private {
        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));
    }

    // Integer square root (Babylonian method). Used for the first mint.
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
