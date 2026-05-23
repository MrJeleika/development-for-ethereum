import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

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

    // Distribute tokens to voters
    await token.write.transfer([alice.account.address, parseEther("1000")]);
    await token.write.transfer([bob.account.address, parseEther("1000")]);
    await token.write.transfer([carol.account.address, parseEther("1000")]);

    // Each voter pre-approves the voting contract to pull their full balance
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
        [alice.account.address, 100n, parseEther("50")],
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

    // TODO: Add tests for the following scenarios:
    //
    // - Two voters voting for the same price stack the weight on that price.
    // - Two voters voting for different prices: the one with more weight wins.
    // - A single voter calling vote() twice for different prices: their
    //   lockedOf grows correctly, each price has the right weight.
    // - The leading price updates when a new vote pushes a different price
    //   above the current leader.
    // - The leading price does NOT update on a tie (first-to-arrive wins).
    // - vote() reverts with VotingEnded when called after votingEnd.
    // - vote() reverts when the voter has not approved the contract for
    //   enough tokens. (The token's own revert will fire; assert it reverts.)
  });

  describe("finalize", function () {
    // TODO: Add tests for the following scenarios:
    //
    // - finalize() reverts with VotingActive before votingEnd.
    // - finalize() sets currentTokenPrice to the leader's price after voting ends.
    // - finalize() sets finalized to true.
    // - finalize() emits PriceFinalized with the correct args.
    // - finalize() reverts with AlreadyFinalized on the second call.
    // - finalize() with no votes succeeds; currentTokenPrice stays 0.
  });

  describe("claim", function () {
    // TODO: Add tests for the following scenarios:
    //
    // - claim() reverts with VotingActive before votingEnd.
    // - claim() reverts with NothingToClaim when the caller has no
    //   locked balance.
    // - claim() returns the locked amount to the caller (check the voter's
    //   token balance before and after).
    // - claim() zeros out the voter's lockedOf.
    // - claim() emits a Claimed event with the right args.
    // - Calling claim() twice from the same voter reverts on the second call.
  });
});
