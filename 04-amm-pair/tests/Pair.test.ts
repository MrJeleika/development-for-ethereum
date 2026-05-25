import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

const { viem } = await network.connect();

// Starter test (provided). It fails until you implement addLiquidity, swap, and
// getAmountOut in Pair.sol — making it pass is your first goal. Do NOT edit this
// file; add your own scenarios in a new test file (see TASK.md for the list).
describe("Pair (pull-based AMM)", function () {
  async function deployFixture() {
    const [deployer, alice] = await viem.getWalletClients();

    const tokenA = await viem.deployContract("Token", ["Token A", "AAA", parseEther("1000000")]);
    const tokenB = await viem.deployContract("Token", ["Token B", "BBB", parseEther("1000000")]);

    const pair = await viem.deployContract("Pair", [tokenA.address, tokenB.address]);

    await tokenA.write.transfer([alice.account.address, parseEther("100000")]);
    await tokenB.write.transfer([alice.account.address, parseEther("100000")]);

    for (const w of [deployer, alice]) {
      await tokenA.write.approve([pair.address, parseEther("1000000")], { account: w.account });
      await tokenB.write.approve([pair.address, parseEther("1000000")], { account: w.account });
    }

    return { pair, tokenA, tokenB, deployer, alice };
  }

  it("a swap charges the 0.3% fee, moves the price, and never lets k decrease", async function () {
    const { pair, tokenA, alice } = await deployFixture();

    // Seed a balanced 1000 / 1000 pool.
    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    const r0Before = (await pair.read.reserve0()) as bigint;
    const r1Before = (await pair.read.reserve1()) as bigint;
    const kBefore = r0Before * r1Before;

    const amountIn = parseEther("100");
    const expectedOut = (await pair.read.getAmountOut([amountIn, r0Before, r1Before])) as bigint;

    // tokenA is token0 here -> swapping A in, B out.
    await pair.write.swap([tokenA.address, amountIn, 0n], { account: alice.account });

    const r0After = (await pair.read.reserve0()) as bigint;
    const r1After = (await pair.read.reserve1()) as bigint;

    // Input pile grew by exactly amountIn; output pile shrank by exactly expectedOut.
    assert.equal(r0After, r0Before + amountIn);
    assert.equal(r1After, r1Before - expectedOut);

    // ~90.661 out for 100 in, on a balanced 1000/1000 pool.
    assert.ok(expectedOut > parseEther("90") && expectedOut < parseEther("91"), `got ${expectedOut}`);

    // The invariant must not decrease — the 0.3% fee makes k strictly grow.
    assert.ok(r0After * r1After > kBefore, "k must not decrease across a swap");
  });
});
