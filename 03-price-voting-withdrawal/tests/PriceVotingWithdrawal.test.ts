import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

const { viem, networkHelpers } = await network.connect();

const VOTING_DURATION = 60 * 60 * 24;

describe("PriceVotingWithdrawal", function () {
  async function deployVotingFixture() {
    const [deployer, alice, bob, carol] = await viem.getWalletClients();

    const token = await viem.deployContract("Token", ["Vote Token", "VOTE", parseEther("1000000")]);

    const now = await networkHelpers.time.latest();
    const votingEnd = BigInt(now + VOTING_DURATION);

    const voting = await viem.deployContract("PriceVotingWithdrawal", [token.address, votingEnd]);

    for (const w of [alice, bob, carol]) {
      await token.write.transfer([w.account.address, parseEther("1000")]);
      await token.write.approve([voting.address, parseEther("1000")], { account: w.account });
    }

    return { token, voting, votingEnd, deployer, alice, bob, carol };
  }

  // Walks the contract's public list to confirm head/tail/links agree and
  // the weights are descending. Returns the prices in head-to-tail order.
  async function snapshotList(voting: any): Promise<bigint[]> {
    const order: bigint[] = [];
    let cur = (await voting.read.head()) as bigint;
    const tail = (await voting.read.tail()) as bigint;
    let prev = 0n;
    let lastWeight: bigint | null = null;

    while (cur !== 0n) {
      const [nodePrev, nodeNext, inList] = (await voting.read.nodes([cur])) as [bigint, bigint, boolean];
      assert.equal(inList, true, `node ${cur} marked not-in-list while traversed`);
      assert.equal(nodePrev, prev, `node ${cur} prev mismatch`);
      const w = (await voting.read.weightOf([cur])) as bigint;
      if (lastWeight !== null) {
        assert.ok(w <= lastWeight, `list not descending at ${cur}: ${w} > ${lastWeight}`);
      }
      lastWeight = w;
      order.push(cur);
      prev = cur;
      cur = nodeNext;
    }

    assert.equal(prev, tail, "tail mismatch at end of traversal");
    return order;
  }

  describe("vote", function () {
    it("inserts the first node at head and tail", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50"), 0n, 0n], { account: alice.account });

      assert.equal(await voting.read.head(), 100n);
      assert.equal(await voting.read.tail(), 100n);
      assert.deepEqual(await snapshotList(voting), [100n]);
    });

    it("inserts a heavier price at the head", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("40"), 0n, 0n], { account: alice.account });
      // bob's price is heavier - insert at head; nextHint must be current head 100
      await voting.write.vote([200n, parseEther("60"), 0n, 100n], { account: bob.account });

      assert.deepEqual(await snapshotList(voting), [200n, 100n]);
      const [p] = await voting.read.leader();
      assert.equal(p, 200n);
    });

    it("inserts a lighter price at the tail", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("60"), 0n, 0n], { account: alice.account });
      // bob's price is lighter - insert at tail; prevHint must be current tail 100
      await voting.write.vote([200n, parseEther("40"), 100n, 0n], { account: bob.account });

      assert.deepEqual(await snapshotList(voting), [100n, 200n]);
    });

    it("inserts a middle-weight price between two existing nodes", async function () {
      const { voting, alice, bob, carol } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("60"), 0n, 0n], { account: alice.account });
      await voting.write.vote([300n, parseEther("20"), 100n, 0n], { account: bob.account });
      // carol's price 200 has weight 40 - between 60 (price 100) and 20 (price 300)
      await voting.write.vote([200n, parseEther("40"), 100n, 300n], { account: carol.account });

      assert.deepEqual(await snapshotList(voting), [100n, 200n, 300n]);
    });

    it("stacks weight on an existing price and repositions it upward", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("40"), 0n, 0n], { account: alice.account });
      await voting.write.vote([200n, parseEther("30"), 100n, 0n], { account: bob.account });
      // Bob doubles down on 200. New weight = 60, should move to head.
      await voting.write.vote([200n, parseEther("30"), 0n, 100n], { account: bob.account });

      assert.deepEqual(await snapshotList(voting), [200n, 100n]);
      assert.equal(await voting.read.weightOf([200n]), parseEther("60"));
    });

    it("emits Voted", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.emitWithArgs(
        voting.write.vote([100n, parseEther("50"), 0n, 0n], { account: alice.account }),
        voting,
        "Voted",
        [getAddress(alice.account.address), 100n, parseEther("50")],
      );
    });

    it("reverts after votingEnd", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.vote([100n, parseEther("10"), 0n, 0n], { account: alice.account }),
        voting,
        "VotingEnded",
      );
    });

    it("reverts on zero amount", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.revertWithCustomError(
        voting.write.vote([100n, 0n, 0n, 0n], { account: alice.account }),
        voting,
        "ZeroAmount",
      );
    });

    it("reverts on price 0", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.revertWithCustomError(
        voting.write.vote([0n, parseEther("10"), 0n, 0n], { account: alice.account }),
        voting,
        "InvalidPrice",
      );
    });
  });

  describe("hint validation", function () {
    it("rejects a non-adjacent (prev, next) pair", async function () {
      const { voting, alice, bob, carol } = await networkHelpers.loadFixture(deployVotingFixture);
      // build list: 100 -> 200 -> 300
      await voting.write.vote([100n, parseEther("60"), 0n, 0n], { account: alice.account });
      await voting.write.vote([200n, parseEther("40"), 100n, 0n], { account: bob.account });
      await voting.write.vote([300n, parseEther("20"), 200n, 0n], { account: carol.account });

      // Try to splice a new node between 100 and 300, skipping 200.
      // Weight 50 satisfies the bounds (100 has weight 60, 300 has 20),
      // but (100, 300) are not adjacent - this MUST revert.
      await viem.assertions.revertWithCustomError(
        voting.write.vote([999n, parseEther("50"), 100n, 300n], { account: alice.account }),
        voting,
        "BadHint",
      );
    });

    it("rejects insert-at-head when nextHint is not the current head", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("60"), 0n, 0n], { account: alice.account });
      await voting.write.vote([200n, parseEther("40"), 100n, 0n], { account: bob.account });

      // Try to claim "I'm the new head, my next is 200" - 200 isn't head, 100 is.
      await viem.assertions.revertWithCustomError(
        voting.write.vote([999n, parseEther("70"), 0n, 200n], { account: alice.account }),
        voting,
        "BadHint",
      );
    });

    it("rejects a prevHint whose weight is less than the new weight", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("30"), 0n, 0n], { account: alice.account });

      // Try to place a 50-weight price AFTER a 30-weight price.
      await viem.assertions.revertWithCustomError(
        voting.write.vote([200n, parseEther("50"), 100n, 0n], { account: alice.account }),
        voting,
        "BadHint",
      );
    });

    it("rejects a tied nextHint (ties stay above the newcomer)", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50"), 0n, 0n], { account: alice.account });

      // Trying to insert 200 ABOVE 100 with equal weight 50 should revert -
      // ties go below the existing node.
      await viem.assertions.revertWithCustomError(
        voting.write.vote([200n, parseEther("50"), 0n, 100n], { account: bob.account }),
        voting,
        "BadHint",
      );
    });

    it("rejects a self-referencing hint", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50"), 0n, 0n], { account: alice.account });

      await viem.assertions.revertWithCustomError(
        voting.write.vote([100n, parseEther("10"), 100n, 0n], { account: alice.account }),
        voting,
        "BadHint",
      );
    });
  });

  describe("withdraw", function () {
    it("returns tokens, decrements weight, and repositions downward", async function () {
      const { token, voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("60"), 0n, 0n], { account: alice.account });
      await voting.write.vote([200n, parseEther("40"), 100n, 0n], { account: bob.account });

      // Alice withdraws 40 - her price drops to weight 20, below 200's weight 40
      const before = await token.read.balanceOf([alice.account.address]);
      await voting.write.withdraw([100n, parseEther("40"), 200n, 0n], { account: alice.account });
      const after = await token.read.balanceOf([alice.account.address]);

      assert.equal(after - before, parseEther("40"));
      assert.equal(await voting.read.weightOf([100n]), parseEther("20"));
      assert.deepEqual(await snapshotList(voting), [200n, 100n]);
    });

    it("promotes the runner-up when the leader's voter withdraws everything", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("100"), 0n, 0n], { account: alice.account });
      await voting.write.vote([200n, parseEther("50"), 100n, 0n], { account: bob.account });

      // Alice fully exits 100 - weight goes to 0, price drops out of list
      await voting.write.withdraw([100n, parseEther("100"), 0n, 0n], { account: alice.account });

      const [p, w] = await voting.read.leader();
      assert.equal(p, 200n);
      assert.equal(w, parseEther("50"));
      assert.deepEqual(await snapshotList(voting), [200n]);
    });

    it("removes a price from the list once weight reaches 0", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("30"), 0n, 0n], { account: alice.account });
      await voting.write.vote([200n, parseEther("20"), 100n, 0n], { account: bob.account });

      await voting.write.withdraw([200n, parseEther("20"), 0n, 0n], { account: bob.account });

      const [, , inList] = (await voting.read.nodes([200n])) as [bigint, bigint, boolean];
      assert.equal(inList, false);
      assert.deepEqual(await snapshotList(voting), [100n]);
    });

    it("can withdraw after voting ends", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50"), 0n, 0n], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);

      await voting.write.withdraw([100n, parseEther("50"), 0n, 0n], { account: alice.account });
      assert.equal(await voting.read.lockedOf([alice.account.address]), 0n);
    });

    it("emits Withdrawn", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50"), 0n, 0n], { account: alice.account });

      await viem.assertions.emitWithArgs(
        voting.write.withdraw([100n, parseEther("20"), 0n, 0n], { account: alice.account }),
        voting,
        "Withdrawn",
        [getAddress(alice.account.address), 100n, parseEther("20")],
      );
    });

    it("reverts when withdrawing more than locked", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("10"), 0n, 0n], { account: alice.account });

      await viem.assertions.revertWithCustomError(
        voting.write.withdraw([100n, parseEther("20"), 0n, 0n], { account: alice.account }),
        voting,
        "InsufficientLocked",
      );
    });

    it("reverts when withdraw hints don't match the new position", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("60"), 0n, 0n], { account: alice.account });
      await voting.write.vote([200n, parseEther("40"), 100n, 0n], { account: bob.account });

      // Alice withdraws 50, leaving 100 at weight 10 - it should go to tail,
      // but passing the OLD hints (head) won't satisfy the weight check
      // against the new neighbor (200 has weight 40 > 10).
      await viem.assertions.revertWithCustomError(
        voting.write.withdraw([100n, parseEther("50"), 0n, 200n], { account: alice.account }),
        voting,
        "BadHint",
      );
    });
  });

  describe("finalize", function () {
    it("reverts before votingEnd", async function () {
      const { voting } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.revertWithCustomError(voting.write.finalize(), voting, "VotingActive");
    });

    it("snapshots the head as the winning price", async function () {
      const { voting, votingEnd, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("30"), 0n, 0n], { account: alice.account });
      await voting.write.vote([200n, parseEther("70"), 0n, 100n], { account: bob.account });

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.finalize();

      assert.equal(await voting.read.currentTokenPrice(), 200n);
      assert.equal(await voting.read.finalized(), true);
    });

    it("returns the correct winner after the leader's voter withdrew", async function () {
      const { voting, votingEnd, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("100"), 0n, 0n], { account: alice.account });
      await voting.write.vote([200n, parseEther("50"), 100n, 0n], { account: bob.account });
      await voting.write.withdraw([100n, parseEther("100"), 0n, 0n], { account: alice.account });

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.finalize();

      assert.equal(await voting.read.currentTokenPrice(), 200n);
    });

    it("cannot be finalized twice", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("10"), 0n, 0n], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.finalize();

      await viem.assertions.revertWithCustomError(voting.write.finalize(), voting, "AlreadyFinalized");
    });

    it("with no votes currentTokenPrice stays 0", async function () {
      const { voting, votingEnd } = await networkHelpers.loadFixture(deployVotingFixture);
      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.finalize();

      assert.equal(await voting.read.currentTokenPrice(), 0n);
    });
  });
});
