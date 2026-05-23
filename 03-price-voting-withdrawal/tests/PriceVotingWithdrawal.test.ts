import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

const { viem, networkHelpers } = await network.connect();

const VOTING_DURATION = 60 * 60 * 24; // 1 day in seconds

describe("PriceVotingWithdrawal", function () {
  async function deployVotingFixture() {
    const [deployer, alice, bob, carol] = await viem.getWalletClients();

    const token = await viem.deployContract("Token", ["Vote Token", "VOTE", parseEther("1000000")]);

    const now = await networkHelpers.time.latest();
    const votingEnd = BigInt(now + VOTING_DURATION);

    const voting = await viem.deployContract("PriceVotingWithdrawal", [token.address, votingEnd]);

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
    // TODO
  });

  describe("withdraw", function () {
    // TODO
  });

  describe("leader", function () {
    // TODO
  });

  describe("winner", function () {
    // TODO
  });
});
