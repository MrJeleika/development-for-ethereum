# Task: Constant-product AMM pair (pull-based, Uniswap V2 style)

Implement a single liquidity-pool contract for two ERC-20 tokens — a
constant-product automated market maker (`x · y = k`). The pair **is itself an
ERC-20**: liquidity providers receive LP tokens representing their share of the
pool. You are given a skeleton; you implement the public functions and write
most of the tests.

This folds Uniswap V2's two layers into one. Real V2 splits it: the **Pair**
(core) holds funds and exposes a low-level push swap, while the **Router**
(periphery) is the friendly layer that pulls your tokens and computes outputs.
Here both live in one contract — the pool pulls input with `transferFrom` and
computes the output for you. No Factory, no Router, no flash swaps, no ETH.

## What you're given

`contracts/Pair.sol` already contains:

- all **state variables**, **events**, and **custom errors**,
- the **constructor**,
- the private **math helpers** (`_sqrt`, `_min`, `_sync`).

The four public functions — `getAmountOut`, `addLiquidity`, `removeLiquidity`,
`swap` — are **stubs that revert**. Implement them. Do not change the public
signatures, event signatures, or error names: the reviewer matches on them.

`contracts/Token.sol` is the generic ERC-20 from earlier tasks. The tests deploy
two instances as `token0` / `token1`.

## The model

Reserves (`reserve0`, `reserve1`) track the pool's accounting **separately from
raw balances**. After every transfer in or out, call `_sync()` to settle the
reserves to the current balances. The product `reserve0 · reserve1 = k` is the
curve; price is just the ratio of the reserves.

### `getAmountOut` — the 0.3% fee formula

```
amountInWithFee = amountIn · 997
amountOut       = (amountInWithFee · reserveOut) / (reserveIn · 1000 + amountInWithFee)
```

Only 99.7% of the input moves along the curve; the skimmed 0.3% stays in the
pool and accrues to LPs. Revert `InsufficientAmount` if `amountIn == 0`, and
`InsufficientLiquidity` if either reserve is 0.

**Worked example to check your math:** a balanced **1000 / 1000** pool, swapping
**100** in, should return **≈ 90.661** out (`99700 · 1000 / (1000·1000 + 99700)
= 99 700 000 / 1 099 700 ≈ 90.6611`). If your formula doesn't reproduce this
number, it's wrong.

### `addLiquidity(amount0, amount1)`

Pull both tokens in via `transferFrom`, then mint LP:

- **First provider** (`totalSupply() == 0`):
  `liquidity = sqrt(amount0 · amount1) − MINIMUM_LIQUIDITY`, and mint
  `MINIMUM_LIQUIDITY` to a dead address (`0xdEaD`) to lock it forever. This is
  required — it blocks the first-depositor share-inflation attack.
- **Later providers:**
  `liquidity = min(amount0 · totalSupply / reserve0, amount1 · totalSupply / reserve1)`.

Mint `liquidity` to the caller, `_sync()`, emit `LiquidityAdded`. Revert
`InsufficientAmount` on a zero input, `InsufficientLiquidity` if `liquidity == 0`.

### `removeLiquidity(liquidity)`

Pay out a pro-rata slice of both reserves
(`amount_i = liquidity · reserve_i / totalSupply`), burn the LP from the caller,
transfer both tokens out, `_sync()`, emit `LiquidityRemoved`.

### `swap(tokenIn, amountIn, minAmountOut)`

Identify direction from `tokenIn` (revert `InvalidToken` if it isn't `token0`
or `token1`). Compute the output with `getAmountOut` against the right reserves;
revert `InsufficientOutput` if it's below `minAmountOut` (slippage guard). Pull
`amountIn` of the input token, transfer the output token out, `_sync()`, emit
`Swapped`.

## Testing requirements

A starter test in `tests/Pair.test.ts` covers a swap — it fails until your
functions work, and making it pass is your first milestone. **Don't edit it.**
Add a new test file with the rest:

1. First `addLiquidity` mints `sqrt(a·b) − 1000` and locks `1000` to `0xdEaD`.
2. A second provider depositing in the same ratio gets proportional LP.
3. An imbalanced deposit mints `min(...)` (the smaller side wins).
4. `removeLiquidity` returns a proportional slice of both reserves and burns the LP.
5. `swap` reverts on `InvalidToken`, and on `InsufficientOutput` when `minAmountOut` is too high.
6. Two swaps in a row: the second gets a worse rate (price moved).
7. `getAmountOut` reverts on zero input and on an empty pool.

## Out of scope (note, don't handle)

Fee-on-transfer / rebasing tokens; TWAP price oracles; flash swaps; reentrancy
hardening (a `lock` modifier) — fine to add, not required for a plain ERC-20.

## Reflection

In a markdown file or a header comment, answer:

**Why is `MINIMUM_LIQUIDITY` locked on the first mint, and what concrete failure
does it prevent?** And: **why does an imbalanced `addLiquidity` use `min(...)`
rather than averaging the two sides?**
