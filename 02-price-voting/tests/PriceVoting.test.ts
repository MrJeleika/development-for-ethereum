import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

const { viem, networkHelpers } = await network.connect();

const ONE_DAY = 60 * 60 * 24;

describe("PriceVoting", function () {
  async function deployVotingFixture() {
    const [deployer, alice, bob, carol] = await viem.getWalletClients();

    const token = await viem.deployContract("Token", ["Vote Token", "VOTE", parseEther("1000000")]);

    const now = await networkHelpers.time.latest();
    const votingEnd = BigInt(now + ONE_DAY);

    const voting = await viem.deployContract("PriceVoting", [token.address, votingEnd]);

    // give voters some tokens and approve the voting contract
    for (const w of [alice, bob, carol]) {
      await token.write.transfer([w.account.address, parseEther("1000")]);
      await token.write.approve([voting.address, parseEther("1000")], { account: w.account });
    }

    return { token, voting, votingEnd, deployer, alice, bob, carol };
  }

  describe("vote", function () {
    it("records a single vote", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], { account: alice.account });

      assert.equal(await voting.read.weightOf([100n]), parseEther("50"));
      assert.equal(await voting.read.lockedOf([alice.account.address]), parseEther("50"));
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

    it("two voters voting the same price stack the weight", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("30")], { account: alice.account });
      await voting.write.vote([100n, parseEther("70")], { account: bob.account });

      assert.equal(await voting.read.weightOf([100n]), parseEther("100"));
    });

    it("the heavier price wins between two voters", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("40")], { account: alice.account });
      await voting.write.vote([200n, parseEther("60")], { account: bob.account });

      const [p, w] = await voting.read.leader();
      assert.equal(p, 200n);
      assert.equal(w, parseEther("60"));
    });

    it("one voter splitting across two prices", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("20")], { account: alice.account });
      await voting.write.vote([200n, parseEther("30")], { account: alice.account });

      assert.equal(await voting.read.weightOf([100n]), parseEther("20"));
      assert.equal(await voting.read.weightOf([200n]), parseEther("30"));
      assert.equal(await voting.read.lockedOf([alice.account.address]), parseEther("50"));
    });

    it("leader updates when a new vote overtakes it", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], { account: alice.account });
      await voting.write.vote([200n, parseEther("60")], { account: bob.account });

      const [p] = await voting.read.leader();
      assert.equal(p, 200n);
    });

    it("does NOT update leader on a tie - first-to-arrive wins", async function () {
      const { voting, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], { account: alice.account });
      await voting.write.vote([200n, parseEther("50")], { account: bob.account });

      const [p, w] = await voting.read.leader();
      assert.equal(p, 100n);
      assert.equal(w, parseEther("50"));
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

    it("reverts when amount is zero", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.revertWithCustomError(
        voting.write.vote([100n, 0n], { account: alice.account }),
        voting,
        "ZeroAmount",
      );
    });

    it("reverts when allowance is not enough", async function () {
      const { token, voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await token.write.approve([voting.address, 0n], { account: alice.account });

      await assert.rejects(
        voting.write.vote([100n, parseEther("10")], { account: alice.account }),
      );
    });
  });

  describe("finalize", function () {
    it("reverts before votingEnd", async function () {
      const { voting } = await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.revertWithCustomError(voting.write.finalize(), voting, "VotingActive");
    });

    it("sets currentTokenPrice and finalized", async function () {
      const { voting, votingEnd, alice, bob } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("30")], { account: alice.account });
      await voting.write.vote([200n, parseEther("70")], { account: bob.account });

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.finalize();

      assert.equal(await voting.read.currentTokenPrice(), 200n);
      assert.equal(await voting.read.finalized(), true);
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

  describe("claim", function () {
    it("reverts before votingEnd", async function () {
      const { voting, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("10")], { account: alice.account });

      await viem.assertions.revertWithCustomError(
        voting.write.claim({ account: alice.account }),
        voting,
        "VotingActive",
      );
    });

    it("reverts if nothing to claim", async function () {
      const { voting, votingEnd, carol } = await networkHelpers.loadFixture(deployVotingFixture);

      await networkHelpers.time.increaseTo(votingEnd);

      await viem.assertions.revertWithCustomError(
        voting.write.claim({ account: carol.account }),
        voting,
        "NothingToClaim",
      );
    });

    it("returns the locked tokens", async function () {
      const { token, voting, votingEnd, alice } = await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("40")], { account: alice.account });

      const before = await token.read.balanceOf([alice.account.address]);

      await networkHelpers.time.increaseTo(votingEnd);
      await voting.write.claim({ account: alice.account });

      const after = await token.read.balanceOf([alice.account.address]);
      assert.equal(after - before, parseEther("40"));
      assert.equal(await voting.read.lockedOf([alice.account.address]), 0n);
    });

    it("cannot claim twice", async function () {
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
