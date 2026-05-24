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

    it("a single vote places the price at the top of the leaderboard", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50")], { account: alice.account });

      const [p, w] = await voting.read.leader();
      assert.equal(p, 100n);
      assert.equal(w, parseEther("50"));
    });

    it("heavier price overtakes the leader", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("40")], { account: alice.account });
      await voting.write.vote([200n, parseEther("60")], { account: bob.account });

      const [p] = await voting.read.leader();
      assert.equal(p, 200n);
    });

    it("stacks weight across voters for the same price", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("30")], { account: alice.account });
      await voting.write.vote([100n, parseEther("70")], { account: bob.account });

      assert.equal(await voting.read.weightOf([100n]), parseEther("100"));
    });

    it("reverts after votingEnd", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.vote([100n, parseEther("10")], { account: alice.account }),
        voting,
        "VotingEnded",
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

    it("can withdraw after voting ends too", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("50")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);

      await voting.write.withdraw([100n, parseEther("50")], { account: alice.account });
      assert.equal(await voting.read.lockedOf([alice.account.address]), 0n);
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

    it("reverts when withdrawing more than locked", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("10")], { account: alice.account });

      await viem.assertions.revertWithCustomError(
        voting.write.withdraw([100n, parseEther("20")], { account: alice.account }),
        voting,
        "InsufficientLocked",
      );
    });

    it("promotes the runner-up when the leader's voter withdraws", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("100")], { account: alice.account });
      await voting.write.vote([200n, parseEther("50")], { account: bob.account });

      // Alice (the leader) withdraws everything
      await voting.write.withdraw([100n, parseEther("100")], { account: alice.account });

      const [p, w] = await voting.read.leader();
      assert.equal(p, 200n);
      assert.equal(w, parseEther("50"));
    });
  });

  describe("finalize", function () {
    it("reverts before votingEnd", async function () {
      const { voting } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.revertWithCustomError(voting.write.finalize(), voting, "VotingActive");
    });

    it("snapshots the leader as the winning price", async function () {
      const { voting, votingEnd, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("30")], { account: alice.account });
      await voting.write.vote([200n, parseEther("70")], { account: bob.account });

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.finalize();

      assert.equal(await voting.read.currentTokenPrice(), 200n);
      assert.equal(await voting.read.finalized(), true);
    });

    it("returns the correct winner even after the leader withdrew", async function () {
      const { voting, votingEnd, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("100")], { account: alice.account });
      await voting.write.vote([200n, parseEther("50")], { account: bob.account });
      await voting.write.withdraw([100n, parseEther("100")], { account: alice.account });

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.finalize();

      assert.equal(await voting.read.currentTokenPrice(), 200n);
    });

    it("cannot be finalized twice", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);
      await voting.write.vote([100n, parseEther("10")], { account: alice.account });
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
