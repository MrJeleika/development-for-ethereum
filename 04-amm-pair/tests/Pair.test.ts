import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, getAddress } from "viem";

const { viem } = await network.connect();

const DEAD = getAddress("0x000000000000000000000000000000000000dEaD");

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

  it("a swap charges the 0.3% fee, moves the price, and does not let k decrease", async function () {
    const { pair, tokenA, alice } = await deployFixture();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    const r0Before = (await pair.read.reserve0()) as bigint;
    const r1Before = (await pair.read.reserve1()) as bigint;
    const kBefore = r0Before * r1Before;

    const amountIn = parseEther("100");
    const expectedOut = (await pair.read.getAmountOut([amountIn, r0Before, r1Before])) as bigint;

    await pair.write.swap([tokenA.address, amountIn, 0n], { account: alice.account });

    const r0After = (await pair.read.reserve0()) as bigint;
    const r1After = (await pair.read.reserve1()) as bigint;

    assert.equal(r0After, r0Before + amountIn);
    assert.equal(r1After, r1Before - expectedOut);
    assert.ok(
      expectedOut > parseEther("90") && expectedOut < parseEther("91"),
      `got ${expectedOut}`,
    );
    assert.ok(r0After * r1After > kBefore, "k must not decrease across a swap");
  });

  describe("addLiquidity", function () {
    it("first deposit mints sqrt(a*b) - MINIMUM_LIQUIDITY and locks the minimum", async function () {
      const { pair, deployer } = await deployFixture();

      await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

      // sqrt(1000e18 * 1000e18) = 1000e18
      assert.equal((await pair.read.balanceOf([deployer.account.address])) as bigint, parseEther("1000") - 1000n);
      assert.equal((await pair.read.balanceOf([DEAD])) as bigint, 1000n);
      assert.equal((await pair.read.totalSupply()) as bigint, parseEther("1000"));
      assert.equal((await pair.read.reserve0()) as bigint, parseEther("1000"));
      assert.equal((await pair.read.reserve1()) as bigint, parseEther("1000"));
    });

    it("a second balanced deposit mints proportional LP", async function () {
      const { pair, alice } = await deployFixture();

      await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);
      await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")], { account: alice.account });

      assert.equal((await pair.read.balanceOf([alice.account.address])) as bigint, parseEther("1000"));
    });

    it("an imbalanced deposit mints from the smaller side", async function () {
      const { pair, alice } = await deployFixture();

      await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);
      // min(500e18 * supply / r0, 1000e18 * supply / r1) = 500e18; the extra token1 is forfeited
      await pair.write.addLiquidity([parseEther("500"), parseEther("1000")], { account: alice.account });

      assert.equal((await pair.read.balanceOf([alice.account.address])) as bigint, parseEther("500"));
    });

    it("reverts on a zero amount", async function () {
      const { pair } = await deployFixture();

      await viem.assertions.revertWithCustomError(
        pair.write.addLiquidity([0n, parseEther("1000")]),
        pair,
        "InsufficientAmount",
      );
    });
  });

  describe("removeLiquidity", function () {
    it("returns a proportional share of both reserves and burns the LP", async function () {
      const { pair, tokenA, tokenB, deployer } = await deployFixture();

      await pair.write.addLiquidity([parseEther("1000"), parseEther("2000")]);
      const lp = (await pair.read.balanceOf([deployer.account.address])) as bigint;

      const a0 = (await tokenA.read.balanceOf([deployer.account.address])) as bigint;
      const b0 = (await tokenB.read.balanceOf([deployer.account.address])) as bigint;

      await pair.write.removeLiquidity([lp]);

      const a1 = (await tokenA.read.balanceOf([deployer.account.address])) as bigint;
      const b1 = (await tokenB.read.balanceOf([deployer.account.address])) as bigint;

      // gets back almost everything; the tiny remainder backs the locked MINIMUM_LIQUIDITY
      assert.ok(a1 - a0 > parseEther("999"));
      assert.ok(b1 - b0 > parseEther("1999"));
      assert.equal((await pair.read.balanceOf([deployer.account.address])) as bigint, 0n);
    });
  });

  describe("swap", function () {
    it("reverts InsufficientOutput when minAmountOut is above the quote", async function () {
      const { pair, tokenA, alice } = await deployFixture();
      await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

      const out = (await pair.read.getAmountOut([
        parseEther("100"),
        parseEther("1000"),
        parseEther("1000"),
      ])) as bigint;

      await viem.assertions.revertWithCustomError(
        pair.write.swap([tokenA.address, parseEther("100"), out + 1n], { account: alice.account }),
        pair,
        "InsufficientOutput",
      );
    });

    it("reverts InvalidToken for a token that is not in the pair", async function () {
      const { pair, alice } = await deployFixture();
      await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

      const other = await viem.deployContract("Token", ["Other", "OTH", parseEther("1000")]);

      await viem.assertions.revertWithCustomError(
        pair.write.swap([other.address, parseEther("10"), 0n], { account: alice.account }),
        pair,
        "InvalidToken",
      );
    });

    it("swaps the other direction too (token1 in, token0 out)", async function () {
      const { pair, tokenA, tokenB, alice } = await deployFixture();
      await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

      const before = (await tokenA.read.balanceOf([alice.account.address])) as bigint;
      await pair.write.swap([tokenB.address, parseEther("100"), 0n], { account: alice.account });
      const after = (await tokenA.read.balanceOf([alice.account.address])) as bigint;

      assert.ok(after - before > parseEther("90") && after - before < parseEther("91"));
    });
  });

  describe("getAmountOut", function () {
    it("reverts on zero input", async function () {
      const { pair } = await deployFixture();
      await viem.assertions.revertWithCustomError(
        pair.read.getAmountOut([0n, parseEther("1000"), parseEther("1000")]),
        pair,
        "InsufficientAmount",
      );
    });

    it("reverts on an empty pool", async function () {
      const { pair } = await deployFixture();
      await viem.assertions.revertWithCustomError(
        pair.read.getAmountOut([parseEther("1"), 0n, parseEther("1000")]),
        pair,
        "InsufficientLiquidity",
      );
    });
  });
});
