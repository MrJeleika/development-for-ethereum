import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

const { viem, networkHelpers } = await network.connect();

const VOTING_DURATION = 60 * 60 * 24; // 1 day
const SETTLE_DURATION = 60 * 60 * 6; // 6 hours

describe("PriceVotingWithdrawal", function () {
  async function deployVotingFixture() {
    const [deployer, alice, bob, carol, dave] = await viem.getWalletClients();

    const token = await viem.deployContract("Token", ["Vote Token", "VOTE", parseEther("1000000")]);

    const now = await networkHelpers.time.latest();
    const votingEnd = BigInt(now + VOTING_DURATION);
    const settleEnd = votingEnd + BigInt(SETTLE_DURATION);

    const voting = await viem.deployContract("PriceVotingWithdrawal", [
      token.address,
      votingEnd,
      BigInt(SETTLE_DURATION),
    ]);

    for (const w of [alice, bob, carol, dave]) {
      await token.write.transfer([w.account.address, parseEther("1000")]);
      await token.write.approve([voting.address, parseEther("1000")], { account: w.account });
    }

    return { token, voting, votingEnd, settleEnd, deployer, alice, bob, carol, dave };
  }

  // ----- VOTING phase -----

  describe("vote", function () {
    it("locks tokens and updates accounting", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], { account: alice.account });

      assert.equal(await voting.read.weightOf([100n]), parseEther("50"));
      assert.equal(await voting.read.lockedOf([alice.account.address]), parseEther("50"));
      assert.equal(await voting.read.lockedFor([alice.account.address, 100n]), parseEther("50"));
    });

    it("emits Voted", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.emitWithArgs(
        voting.write.vote([100n, parseEther("50")], { account: alice.account }),
        voting,
        "Voted",
        [getAddress(alice.account.address), 100n, parseEther("50")],
      );
    });

    it("stacks weight across voters", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("30")], { account: alice.account });
      await voting.write.vote([100n, parseEther("70")], { account: bob.account });

      assert.equal(await voting.read.weightOf([100n]), parseEther("100"));
    });

    it("reverts in settlement phase", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.vote([100n, parseEther("10")], { account: alice.account }),
        voting,
        "VotingPhaseOnly",
      );
    });

    it("reverts on zero amount", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.revertWithCustomError(
        voting.write.vote([100n, 0n], { account: alice.account }),
        voting,
        "ZeroAmount",
      );
    });
  });

  describe("withdraw", function () {
    it("returns tokens and decrements weight during voting", async function () {
      const { token, voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], { account: alice.account });

      const before = await token.read.balanceOf([alice.account.address]);
      await voting.write.withdraw([100n, parseEther("30")], { account: alice.account });
      const after = await token.read.balanceOf([alice.account.address]);

      assert.equal(after - before, parseEther("30"));
      assert.equal(await voting.read.weightOf([100n]), parseEther("20"));
      assert.equal(await voting.read.lockedOf([alice.account.address]), parseEther("20"));
    });

    it("emits Withdrawn", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50")], { account: alice.account });

      await viem.assertions.emitWithArgs(
        voting.write.withdraw([100n, parseEther("20")], { account: alice.account }),
        voting,
        "Withdrawn",
        [getAddress(alice.account.address), 100n, parseEther("20")],
      );
    });

    it("reverts in settlement phase", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.withdraw([100n, parseEther("10")], { account: alice.account }),
        voting,
        "VotingPhaseOnly",
      );
    });

    it("reverts when withdrawing more than locked", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("10")], { account: alice.account });

      await viem.assertions.revertWithCustomError(
        voting.write.withdraw([100n, parseEther("20")], { account: alice.account }),
        voting,
        "InsufficientLocked",
      );
    });
  });

  // ----- SETTLEMENT phase -----

  describe("propagate", function () {
    it("reverts before votingEnd", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50")], { account: alice.account });

      await viem.assertions.revertWithCustomError(
        voting.write.propagate([100n], { account: alice.account }),
        voting,
        "SettlementPhaseOnly",
      );
    });

    it("reverts after settleEnd", async function () {
      const { voting, settleEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50")], { account: alice.account });
      await networkHelpers.time.increaseTo(settleEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.propagate([100n], { account: alice.account }),
        voting,
        "SettlementPhaseOnly",
      );
    });

    it("reverts for non-voters (lockedOf == 0)", async function () {
      const { voting, votingEnd, alice, dave } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.propagate([100n], { account: dave.account }),
        voting,
        "NotAVoter",
      );
    });

    it("fixes the stale leader pointer after a leader withdrawal", async function () {
      const { voting, votingEnd, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      // Alice's price becomes leader during voting
      await voting.write.vote([100n, parseEther("100")], { account: alice.account });
      // Bob votes a smaller amount on a different price
      await voting.write.vote([200n, parseEther("50")], { account: bob.account });
      // Alice withdraws everything; leader pointer is now stale (still points to 100)
      await voting.write.withdraw([100n, parseEther("100")], { account: alice.account });

      // confirm staleness mid-voting
      assert.equal(await voting.read.leaderPrice(), 100n);
      assert.equal(await voting.read.weightOf([100n]), 0n);
      assert.equal(await voting.read.weightOf([200n]), parseEther("50"));

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.propagate([200n], { account: bob.account });

      assert.equal(await voting.read.leaderPrice(), 200n);
      assert.equal(await voting.read.propagator(), getAddress(bob.account.address));
    });

    it("emits Propagated when the pointer moves", async function () {
      const { voting, votingEnd, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("100")], { account: alice.account });
      await voting.write.vote([200n, parseEther("50")], { account: bob.account });
      await voting.write.withdraw([100n, parseEther("100")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.emitWithArgs(
        voting.write.propagate([200n], { account: bob.account }),
        voting,
        "Propagated",
        [getAddress(bob.account.address), 200n, parseEther("50")],
      );
    });

    it("allows registering a claim for the price already at the top", async function () {
      const { voting, votingEnd, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("60")], { account: alice.account });
      await voting.write.vote([100n, parseEther("30")], { account: bob.account });
      await networkHelpers.time.increaseTo(votingEnd);

      // Alice propagates the current leader - no pointer change, but her claim is registered
      await voting.write.propagate([100n], { account: alice.account });
      assert.equal(await voting.read.claimedLeaderOf([alice.account.address]), 100n);
      assert.equal(await voting.read.hasPropagated([alice.account.address]), true);
    });

    it("reverts when candidate is strictly worse than current leader", async function () {
      const { voting, votingEnd, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("60")], { account: alice.account });
      await voting.write.vote([200n, parseEther("30")], { account: bob.account });
      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.propagate([200n], { account: bob.account }),
        voting,
        "NotABetterCandidate",
      );
    });
  });

  // ----- CLAIM phase -----

  describe("claim", function () {
    it("returns tokens to voters who propagated the winner", async function () {
      const { token, voting, votingEnd, settleEnd, alice, bob } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("100")], { account: alice.account });
      await voting.write.vote([200n, parseEther("50")], { account: bob.account });
      await voting.write.withdraw([100n, parseEther("100")], { account: alice.account });

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.propagate([200n], { account: bob.account });

      await networkHelpers.time.increaseTo(settleEnd);

      const before = await token.read.balanceOf([bob.account.address]);
      await voting.write.claim({ account: bob.account });
      const after = await token.read.balanceOf([bob.account.address]);

      assert.equal(after - before, parseEther("50"));
      assert.equal(await voting.read.lockedOf([bob.account.address]), 0n);
    });

    it("forfeits the locked balance of voters who didn't propagate", async function () {
      const { token, voting, votingEnd, settleEnd, alice, bob } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("60")], { account: alice.account });
      await voting.write.vote([200n, parseEther("40")], { account: bob.account });

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.propagate([100n], { account: alice.account });

      await networkHelpers.time.increaseTo(settleEnd);

      const before = await token.read.balanceOf([bob.account.address]);
      await voting.write.claim({ account: bob.account });
      const after = await token.read.balanceOf([bob.account.address]);

      assert.equal(after, before); // nothing returned
      assert.equal(await voting.read.forfeitedPool(), parseEther("40"));
    });

    it("a stale claim (overtaken by a later better candidate) forfeits", async function () {
      const { token, voting, votingEnd, settleEnd, alice, bob, carol } =
        await networkHelpers.loadFixture(deployVotingFixture);

      // Alice votes large for 100, then withdraws -> leaderPrice stale-high at 100
      await voting.write.vote([100n, parseEther("100")], { account: alice.account });
      // Bob votes smaller for 200 - not leader during voting
      await voting.write.vote([200n, parseEther("50")], { account: bob.account });
      // Carol also votes 100 so she has stake but for the now-stale leader
      await voting.write.vote([100n, parseEther("30")], { account: carol.account });
      await voting.write.withdraw([100n, parseEther("100")], { account: alice.account });
      // weightOf[100]=30, weightOf[200]=50, leaderPrice stale at 100

      await networkHelpers.time.increaseTo(votingEnd);

      // Carol propagates 100 first - matches the stale pointer, she becomes propagator
      await voting.write.propagate([100n], { account: carol.account });
      // Bob then propagates 200 - 50 > 30, pointer moves and Bob becomes propagator
      await voting.write.propagate([200n], { account: bob.account });
      // Carol does NOT re-propagate. Her claim is now stale (100 != 200).

      await networkHelpers.time.increaseTo(settleEnd);

      // Carol forfeits
      await voting.write.claim({ account: carol.account });
      assert.equal(await voting.read.forfeitedPool(), parseEther("30"));

      // Bob's claim is correct
      const before = await token.read.balanceOf([bob.account.address]);
      await voting.write.claim({ account: bob.account });
      const after = await token.read.balanceOf([bob.account.address]);
      assert.equal(after - before, parseEther("50"));

      // And Bob the propagator can sweep the bonus
      const beforeBonus = await token.read.balanceOf([bob.account.address]);
      await voting.write.claimBonus({ account: bob.account });
      const afterBonus = await token.read.balanceOf([bob.account.address]);
      assert.equal(afterBonus - beforeBonus, parseEther("30"));
    });

    it("reverts before settleEnd", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("10")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.claim({ account: alice.account }),
        voting,
        "ClaimPhaseOnly",
      );
    });

    it("cannot be claimed twice", async function () {
      const { voting, votingEnd, settleEnd, alice } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("10")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.propagate([100n], { account: alice.account });
      await networkHelpers.time.increaseTo(settleEnd);

      await voting.write.claim({ account: alice.account });
      await viem.assertions.revertWithCustomError(
        voting.write.claim({ account: alice.account }),
        voting,
        "AlreadyClaimed",
      );
    });
  });

  describe("claimBonus", function () {
    it("pays the propagator the forfeited pool", async function () {
      const { token, voting, votingEnd, settleEnd, alice, bob, carol } =
        await networkHelpers.loadFixture(deployVotingFixture);

      // Setup: 100 wins, propagated by Alice. Bob and Carol lose by not propagating.
      await voting.write.vote([100n, parseEther("60")], { account: alice.account });
      await voting.write.vote([200n, parseEther("40")], { account: bob.account });
      await voting.write.vote([300n, parseEther("20")], { account: carol.account });

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.propagate([100n], { account: alice.account });

      await networkHelpers.time.increaseTo(settleEnd);

      // Bob and Carol claim wrong / no-claim - their tokens move to pool
      await voting.write.claim({ account: bob.account });
      await voting.write.claim({ account: carol.account });

      assert.equal(await voting.read.forfeitedPool(), parseEther("60"));

      // Alice claims her own deposit back
      await voting.write.claim({ account: alice.account });

      // Then Alice (the propagator) sweeps the bonus
      const before = await token.read.balanceOf([alice.account.address]);
      await voting.write.claimBonus({ account: alice.account });
      const after = await token.read.balanceOf([alice.account.address]);

      assert.equal(after - before, parseEther("60"));
      assert.equal(await voting.read.forfeitedPool(), 0n);
      assert.equal(await voting.read.bonusClaimed(), true);
    });

    it("reverts when called by anyone other than the propagator", async function () {
      const { voting, votingEnd, settleEnd, alice, bob } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("60")], { account: alice.account });
      await voting.write.vote([200n, parseEther("40")], { account: bob.account });
      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.propagate([100n], { account: alice.account });
      await networkHelpers.time.increaseTo(settleEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.claimBonus({ account: bob.account }),
        voting,
        "NotPropagator",
      );
    });

    it("cannot be claimed twice", async function () {
      const { voting, votingEnd, settleEnd, alice } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("10")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.propagate([100n], { account: alice.account });
      await networkHelpers.time.increaseTo(settleEnd);

      await voting.write.claimBonus({ account: alice.account });
      await viem.assertions.revertWithCustomError(
        voting.write.claimBonus({ account: alice.account }),
        voting,
        "BonusAlreadyClaimed",
      );
    });
  });

  describe("currentTokenPrice", function () {
    it("returns 0 before settleEnd", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("10")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);

      assert.equal(await voting.read.currentTokenPrice(), 0n);
    });

    it("returns the winning price after settleEnd", async function () {
      const { voting, votingEnd, settleEnd, alice } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("10")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.propagate([100n], { account: alice.account });
      await networkHelpers.time.increaseTo(settleEnd);

      assert.equal(await voting.read.currentTokenPrice(), 100n);
    });
  });
});
