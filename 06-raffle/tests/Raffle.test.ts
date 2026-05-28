import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, getAddress, type Address } from "viem";

const { viem, networkHelpers } = await network.connect();

const KEY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const CALLBACK_GAS = 500_000;

function winningEntryIndex(pick: bigint, prefixWeights: readonly bigint[]): number {
  for (let i = 0; i < prefixWeights.length; i++) {
    const prev = i === 0 ? 0n : prefixWeights[i - 1]!;
    if (pick >= prev && pick < prefixWeights[i]!) return i;
  }
  throw new Error(`pick ${pick} out of range`);
}

describe("Raffle", function () {
  async function deployFixture() {
    const [deployer, alice, bob] = await viem.getWalletClients();

    const btc = await viem.deployContract("Token", ["Bitcoin", "BTC", parseEther("1000000")]);
    const feed = await viem.deployContract("PriceFeedMock", [8, 60_000n * 10n ** 8n]);

    const coord = await viem.deployContract("VRFCoordinatorMock", [10n ** 17n, 10n ** 9n, 10n ** 15n]);

    await coord.write.createSubscription();
    const [created] = await coord.getEvents.SubscriptionCreated({}, { fromBlock: 0n });
    const subId = created.args.subId as bigint;
    await coord.write.fundSubscription([subId, parseEther("1000000")]);

    const now = await networkHelpers.time.latest();
    const drawTime = BigInt(now + 600);

    const raffle = await viem.deployContract("Raffle", [
      btc.address,
      feed.address,
      drawTime,
      coord.address,
      subId,
      KEY_HASH,
      CALLBACK_GAS,
    ]);
    await coord.write.addConsumer([subId, raffle.address]);

    for (const w of [alice, bob]) {
      await btc.write.transfer([w.account.address, parseEther("100")]);
      await btc.write.approve([raffle.address, parseEther("100")], { account: w.account });
    }

    return { btc, feed, coord, raffle, subId, drawTime, deployer, alice, bob };
  }

  async function fulfillWithPick(
    raffle: Awaited<ReturnType<typeof deployFixture>>["raffle"],
    coord: Awaited<ReturnType<typeof deployFixture>>["coord"],
    pick: bigint,
  ) {
    const requestId = (await raffle.read.requestId()) as bigint;
    await coord.write.fulfillRandomWordsWithOverride([requestId, raffle.address, [pick]]);
  }

  async function prefixWeights(raffle: Awaited<ReturnType<typeof deployFixture>>["raffle"]) {
    const n = Number(await raffle.read.entryCount());
    const weights: bigint[] = [];
    for (let i = 0; i < n; i++) {
      weights.push((await raffle.read.prefixWeight([BigInt(i)])) as bigint);
    }
    return weights;
  }

  it("runs the full raffle: deposit, draw, weighted winner, claim", async function () {
    const { btc, coord, raffle, drawTime, alice, bob } = await deployFixture();

    await raffle.write.deposit([parseEther("1")], { account: alice.account });
    await raffle.write.deposit([parseEther("3")], { account: bob.account });

    await networkHelpers.time.increaseTo(drawTime);
    await raffle.write.drawWinner();

    const requestId = (await raffle.read.requestId()) as bigint;
    const totalWeight = (await raffle.read.totalWeight()) as bigint;

    await coord.write.fulfillRandomWordsWithOverride([requestId, raffle.address, [totalWeight - 1n]]);

    assert.equal(getAddress((await raffle.read.winner()) as string), getAddress(bob.account.address));

    const before = (await btc.read.balanceOf([bob.account.address])) as bigint;
    await raffle.write.claim({ account: bob.account });
    const after = (await btc.read.balanceOf([bob.account.address])) as bigint;

    assert.equal(after - before, parseEther("4"));
  });

  describe("deposit", function () {
    it("reverts on zero amount", async function () {
      const { raffle, alice } = await deployFixture();
      await assert.rejects(raffle.write.deposit([0n], { account: alice.account }));
    });

    it("reverts after the deadline", async function () {
      const { raffle, drawTime, alice } = await deployFixture();
      await networkHelpers.time.increaseTo(drawTime);
      await assert.rejects(raffle.write.deposit([parseEther("1")], { account: alice.account }));
    });

    it("reverts once a draw has been requested", async function () {
      const { raffle, drawTime, alice } = await deployFixture();
      await raffle.write.deposit([parseEther("1")], { account: alice.account });
      await networkHelpers.time.increaseTo(drawTime);
      await raffle.write.drawWinner();
      await assert.rejects(raffle.write.deposit([parseEther("1")], { account: alice.account }));
    });

    it("reverts on non-positive feed price", async function () {
      const { feed, raffle, alice } = await deployFixture();
      await feed.write.updateAnswer([0n]);
      await assert.rejects(raffle.write.deposit([parseEther("1")], { account: alice.account }));
    });

    it("reverts on stale feed data", async function () {
      const { feed, raffle, alice } = await deployFixture();
      await feed.write.updateAnswer([60_000n * 10n ** 8n]);
      // Feed was fresh at update; advance past MAX_PRICE_AGE without a new round.
      await networkHelpers.time.increase(3601);
      await assert.rejects(raffle.write.deposit([parseEther("1")], { account: alice.account }));
    });
  });

  describe("drawWinner", function () {
    it("reverts before the deadline", async function () {
      const { raffle, alice } = await deployFixture();
      await raffle.write.deposit([parseEther("1")], { account: alice.account });
      await assert.rejects(raffle.write.drawWinner());
    });

    it("reverts with no deposits", async function () {
      const { raffle, drawTime } = await deployFixture();
      await networkHelpers.time.increaseTo(drawTime);
      await assert.rejects(raffle.write.drawWinner());
    });

    it("reverts if called twice", async function () {
      const { raffle, drawTime, alice } = await deployFixture();
      await raffle.write.deposit([parseEther("1")], { account: alice.account });
      await networkHelpers.time.increaseTo(drawTime);
      await raffle.write.drawWinner();
      await assert.rejects(raffle.write.drawWinner());
    });
  });

  describe("fulfillRandomWords", function () {
    it("stores only the random word and rejects a mismatched request id", async function () {
      const { coord, raffle, drawTime, alice } = await deployFixture();
      await raffle.write.deposit([parseEther("1")], { account: alice.account });
      await networkHelpers.time.increaseTo(drawTime);
      await raffle.write.drawWinner();

      const requestId = (await raffle.read.requestId()) as bigint;
      await assert.rejects(
        coord.write.fulfillRandomWordsWithOverride([requestId + 1n, raffle.address, [42n]]),
      );
      assert.equal(await raffle.read.randomWord(), 0n);

      await coord.write.fulfillRandomWordsWithOverride([requestId, raffle.address, [42n]]);
      assert.equal(await raffle.read.randomWord(), 42n);
    });
  });

  describe("claim", function () {
    async function drawnTwoPlayerFixture() {
      const fx = await deployFixture();
      const { raffle, drawTime, alice, bob } = fx;
      await raffle.write.deposit([parseEther("1")], { account: alice.account });
      await raffle.write.deposit([parseEther("3")], { account: bob.account });
      await networkHelpers.time.increaseTo(drawTime);
      await raffle.write.drawWinner();
      return fx;
    }

    it("reverts InvalidClaim for the wrong entry index", async function () {
      const { raffle, coord, alice } = await drawnTwoPlayerFixture();
      const weights = await prefixWeights(raffle);
      const aliceIdx = winningEntryIndex(0n, weights);
      await fulfillWithPick(raffle, coord, 0n);

      const wrongIdx = aliceIdx === 0 ? 1 : 0;
      await assert.rejects(raffle.write.claim([BigInt(wrongIdx)], { account: alice.account }));
    });

    it("reverts InvalidClaim when a non-owner tries the winning index", async function () {
      const { raffle, coord, alice, bob } = await drawnTwoPlayerFixture();
      const totalWeight = (await raffle.read.totalWeight()) as bigint;
      await fulfillWithPick(raffle, coord, totalWeight - 1n);

      await assert.rejects(raffle.write.claim([1n], { account: alice.account }));
      assert.equal(getAddress((await raffle.read.winner()) as string), getAddress(bob.account.address));
    });

    it("succeeds with claim(entryIndex) for the true winner", async function () {
      const { btc, raffle, coord, bob } = await drawnTwoPlayerFixture();
      const totalWeight = (await raffle.read.totalWeight()) as bigint;
      await fulfillWithPick(raffle, coord, totalWeight - 1n);

      const before = (await btc.read.balanceOf([bob.account.address])) as bigint;
      await raffle.write.claim([1n], { account: bob.account });
      const after = (await btc.read.balanceOf([bob.account.address])) as bigint;
      assert.equal(after - before, parseEther("4"));
    });

    it("reverts on a second claim", async function () {
      const { raffle, coord, bob } = await drawnTwoPlayerFixture();
      const totalWeight = (await raffle.read.totalWeight()) as bigint;
      await fulfillWithPick(raffle, coord, totalWeight - 1n);
      await raffle.write.claim([1n], { account: bob.account });
      await assert.rejects(raffle.write.claim([1n], { account: bob.account }));
    });

    it("reverts before the random word arrives", async function () {
      const { raffle, bob } = await drawnTwoPlayerFixture();
      await assert.rejects(raffle.write.claim([1n], { account: bob.account }));
    });

    it("first entry wins at the top of its range", async function () {
      const { btc, raffle, coord, drawTime, alice, bob } = await deployFixture();
      await raffle.write.deposit([parseEther("1")], { account: alice.account });
      await raffle.write.deposit([parseEther("3")], { account: bob.account });
      await networkHelpers.time.increaseTo(drawTime);
      await raffle.write.drawWinner();

      const weights = await prefixWeights(raffle);
      const pick = weights[0]! - 1n;
      await fulfillWithPick(raffle, coord, pick);

      assert.equal(getAddress((await raffle.read.winner()) as string), getAddress(alice.account.address));
      const before = (await btc.read.balanceOf([alice.account.address])) as bigint;
      await raffle.write.claim([0n], { account: alice.account });
      const after = (await btc.read.balanceOf([alice.account.address])) as bigint;
      assert.equal(after - before, parseEther("4"));
    });

    it("weights multiple deposits from the same player separately", async function () {
      const { btc, raffle, coord, drawTime, alice, bob } = await deployFixture();
      await raffle.write.deposit([parseEther("1")], { account: alice.account });
      await raffle.write.deposit([parseEther("1")], { account: bob.account });
      await raffle.write.deposit([parseEther("2")], { account: bob.account });
      await networkHelpers.time.increaseTo(drawTime);
      await raffle.write.drawWinner();

      const weights = await prefixWeights(raffle);
      // Second entry (bob's first deposit) spans [weights[0], weights[1]).
      const pick = weights[0]!;
      await fulfillWithPick(raffle, coord, pick);

      assert.equal(getAddress((await raffle.read.winner()) as Address), getAddress(bob.account.address));
      const before = (await btc.read.balanceOf([bob.account.address])) as bigint;
      await raffle.write.claim([1n], { account: bob.account });
      const after = (await btc.read.balanceOf([bob.account.address])) as bigint;
      assert.equal(after - before, parseEther("4"));
    });
  });
});
