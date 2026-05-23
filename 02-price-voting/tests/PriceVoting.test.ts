import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

const { viem, networkHelpers } = await network.connect();

const VOTING_DURATION = 60 * 60 * 24; // 1 day in seconds

describe("PriceVoting", function () {
  // The fixture deploys the token, deploys the voting contract, and gives
  // three voters a stash of tokens plus approval for the voting contract to
  // pull those tokens. Every test starts from this clean state.
  async function deployVotingFixture() {
    const [deployer, alice, bob, carol] = await viem.getWalletClients();

    const token = await viem.deployContract("Token", ["Vote Token", "VOTE", parseEther("1000000")]);

    const now = await networkHelpers.time.latest();
    const votingEnd = BigInt(now + VOTING_DURATION);

    const voting = await viem.deployContract("PriceVoting", [token.address, votingEnd]);

    await token.write.transfer([alice.account.address, parseEther("1000")]);
    await token.write.transfer([bob.account.address, parseEther("1000")]);
    await token.write.transfer([carol.account.address, parseEther("1000")]);

    await token.write.approve([voting.address, parseEther("1000")], {
      account: alice.account,
    });
    await token.write.approve([voting.address, parseEther("1000")], {
      account: bob.account,
    });
    await token.write.approve([voting.address, parseEther("1000")], {
      account: carol.account,
    });

    return { token, voting, votingEnd, deployer, alice, bob, carol };
  }

  describe("vote", function () {
    it("records a single vote correctly", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], { account: alice.account });

      assert.equal(await voting.read.weightOf([100n]), parseEther("50"));
      assert.equal(await voting.read.lockedOf([alice.account.address]), parseEther("50"));

      const [leadPrice, leadWeight] = await voting.read.leader();
      assert.equal(leadPrice, 100n);
      assert.equal(leadWeight, parseEther("50"));
    });

    it("emits a Voted event with the right args", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.emitWithArgs(
        voting.write.vote([100n, parseEther("50")], { account: alice.account }),
        voting,
        "Voted",
        [getAddress(alice.account.address), 100n, parseEther("50")],
      );
    });

    it("reverts with ZeroAmount when amount is 0", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.revertWithCustomError(
        voting.write.vote([100n, 0n], { account: alice.account }),
        voting,
        "ZeroAmount",
      );
    });

    it("stacks weight when two voters vote for the same price", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("30")], { account: alice.account });
      await voting.write.vote([100n, parseEther("70")], { account: bob.account });

      assert.equal(await voting.read.weightOf([100n]), parseEther("100"));
      assert.equal(await voting.read.lockedOf([alice.account.address]), parseEther("30"));
      assert.equal(await voting.read.lockedOf([bob.account.address]), parseEther("70"));
    });

    it("picks the heavier price when two voters vote for different prices", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("40")], { account: alice.account });
      await voting.write.vote([200n, parseEther("60")], { account: bob.account });

      const [leadPrice, leadWeight] = await voting.read.leader();
      assert.equal(leadPrice, 200n);
      assert.equal(leadWeight, parseEther("60"));
    });

    it("tracks per-price weight and total locked when one voter splits across prices", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("20")], { account: alice.account });
      await voting.write.vote([200n, parseEther("30")], { account: alice.account });

      assert.equal(await voting.read.weightOf([100n]), parseEther("20"));
      assert.equal(await voting.read.weightOf([200n]), parseEther("30"));
      assert.equal(await voting.read.lockedOf([alice.account.address]), parseEther("50"));
    });

    it("updates the leader when a new vote pushes a different price above it", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], { account: alice.account });
      let [leadPrice] = await voting.read.leader();
      assert.equal(leadPrice, 100n);

      await voting.write.vote([200n, parseEther("60")], { account: bob.account });
      [leadPrice] = await voting.read.leader();
      assert.equal(leadPrice, 200n);
    });

    it("does NOT update the leader on a tie - first-to-arrive wins", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], { account: alice.account });
      await voting.write.vote([200n, parseEther("50")], { account: bob.account });

      const [leadPrice, leadWeight] = await voting.read.leader();
      assert.equal(leadPrice, 100n);
      assert.equal(leadWeight, parseEther("50"));
    });

    it("reverts with VotingEnded when called after votingEnd", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.vote([100n, parseEther("10")], { account: alice.account }),
        voting,
        "VotingEnded",
      );
    });

    it("reverts when the voter has not approved enough tokens", async function () {
      const { token, voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      // Drop approval to zero
      await token.write.approve([voting.address, 0n], { account: alice.account });

      await assert.rejects(
        voting.write.vote([100n, parseEther("10")], { account: alice.account }),
      );
    });
  });

  describe("finalize", function () {
    it("reverts with VotingActive before votingEnd", async function () {
      const { voting } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.revertWithCustomError(voting.write.finalize(), voting, "VotingActive");
    });

    it("sets currentTokenPrice and finalized, and emits PriceFinalized", async function () {
      const { voting, votingEnd, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("30")], { account: alice.account });
      await voting.write.vote([200n, parseEther("70")], { account: bob.account });

      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.emitWithArgs(voting.write.finalize(), voting, "PriceFinalized", [
        200n,
        parseEther("70"),
      ]);

      assert.equal(await voting.read.currentTokenPrice(), 200n);
      assert.equal(await voting.read.finalized(), true);
    });

    it("reverts with AlreadyFinalized on the second call", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("10")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.finalize();

      await viem.assertions.revertWithCustomError(voting.write.finalize(), voting, "AlreadyFinalized");
    });

    it("succeeds with no votes; currentTokenPrice stays 0", async function () {
      const { voting, votingEnd } = await networkHelpers.loadFixture(deployVotingFixture);

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.finalize();

      assert.equal(await voting.read.currentTokenPrice(), 0n);
      assert.equal(await voting.read.finalized(), true);
    });
  });

  describe("claim", function () {
    it("reverts with VotingActive before votingEnd", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("10")], { account: alice.account });

      await viem.assertions.revertWithCustomError(
        voting.write.claim({ account: alice.account }),
        voting,
        "VotingActive",
      );
    });

    it("reverts with NothingToClaim when the caller has no locked balance", async function () {
      const { voting, votingEnd, carol } = await networkHelpers.loadFixture(deployVotingFixture);

      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.claim({ account: carol.account }),
        voting,
        "NothingToClaim",
      );
    });

    it("returns locked tokens and zeros out lockedOf, emitting Claimed", async function () {
      const { token, voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("40")], { account: alice.account });
      await voting.write.vote([200n, parseEther("10")], { account: alice.account });

      const balanceBefore = await token.read.balanceOf([alice.account.address]);

      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.emitWithArgs(
        voting.write.claim({ account: alice.account }),
        voting,
        "Claimed",
        [getAddress(alice.account.address), parseEther("50")],
      );

      const balanceAfter = await token.read.balanceOf([alice.account.address]);
      assert.equal(balanceAfter - balanceBefore, parseEther("50"));
      assert.equal(await voting.read.lockedOf([alice.account.address]), 0n);
    });

    it("reverts on the second claim from the same voter", async function () {
      const { voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("20")], { account: alice.account });
      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.claim({ account: alice.account });

      await viem.assertions.revertWithCustomError(
        voting.write.claim({ account: alice.account }),
        voting,
        "NothingToClaim",
      );
    });
  });
});
