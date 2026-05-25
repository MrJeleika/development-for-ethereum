import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, getAddress } from "viem";
import { MerkleTree, type AirdropEntry } from "./merkle.ts";
import { signAirdropClaim } from "./signatures.ts";

const { viem } = await network.connect();

describe("MerkleAirdrop", function () {
  async function deployFixture() {
    const [deployer, alice, bob, carol, signer, dave, eve] = await viem.getWalletClients();

    const entries: AirdropEntry[] = [
      { account: getAddress(alice.account.address), amount: parseEther("100") },
      { account: getAddress(bob.account.address), amount: parseEther("200") },
      { account: getAddress(carol.account.address), amount: parseEther("300") },
      { account: getAddress(eve.account.address), amount: parseEther("50") },
    ];
    const tree = new MerkleTree(entries);

    const token = await viem.deployContract("Token", [
      "Redduck Token",
      "RDDK",
      parseEther("100000000000000"),
    ]);
    const airdrop = await viem.deployContract("MerkleAirdrop", [
      token.address,
      tree.root,
      signer.account.address,
    ]);

    await token.write.transfer([airdrop.address, parseEther("100000000000000")], {
      account: deployer.account,
    });

    return { entries, tree, token, airdrop, deployer, alice, bob, carol, signer, dave, eve };
  }

  it("lets an eligible account claim its allocation with a Merkle proof", async function () {
    const { entries, tree, token, airdrop, alice } = await deployFixture();

    const proof = tree.getProof(0);
    const { account, amount } = entries[0];

    await airdrop.write.claim([amount, proof], { account: alice.account });

    assert.equal((await token.read.balanceOf([account])) as bigint, amount);
    assert.equal((await airdrop.read.hasClaimed([account])) as boolean, true);
  });

  it("lets an authorized account claim with an admin signature (not on the Merkle list)", async function () {
    const { token, airdrop, signer, dave } = await deployFixture();

    const daveAddr = getAddress(dave.account.address);
    const amount = parseEther("50");

    const { v, r, s } = await signAirdropClaim(signer, daveAddr, amount);

    await airdrop.write.claimWithSignature([amount, v, r, s], { account: dave.account });

    assert.equal((await token.read.balanceOf([daveAddr])) as bigint, amount);
    assert.equal((await airdrop.read.hasClaimed([daveAddr])) as boolean, true);
  });

  // ----- Merkle path: negative cases -----

  it("claim reverts InvalidProof when the amount doesn't match the leaf", async function () {
    const { tree, airdrop, alice } = await deployFixture();

    await viem.assertions.revertWithCustomError(
      airdrop.write.claim([parseEther("999"), tree.getProof(0)], { account: alice.account }),
      airdrop,
      "InvalidProof",
    );
  });

  it("claim reverts InvalidProof when the proof belongs to someone else", async function () {
    const { entries, tree, airdrop, alice } = await deployFixture();

    await viem.assertions.revertWithCustomError(
      airdrop.write.claim([entries[0].amount, tree.getProof(1)], { account: alice.account }),
      airdrop,
      "InvalidProof",
    );
  });

  it("claim reverts AlreadyClaimed on a second claim", async function () {
    const { entries, tree, airdrop, alice } = await deployFixture();
    const proof = tree.getProof(0);

    await airdrop.write.claim([entries[0].amount, proof], { account: alice.account });

    await viem.assertions.revertWithCustomError(
      airdrop.write.claim([entries[0].amount, proof], { account: alice.account }),
      airdrop,
      "AlreadyClaimed",
    );
  });

  it("lets several eligible accounts each claim their own allocation", async function () {
    const { entries, tree, token, airdrop, bob, carol } = await deployFixture();

    await airdrop.write.claim([entries[1].amount, tree.getProof(1)], { account: bob.account });
    await airdrop.write.claim([entries[2].amount, tree.getProof(2)], { account: carol.account });

    assert.equal((await token.read.balanceOf([entries[1].account])) as bigint, entries[1].amount);
    assert.equal((await token.read.balanceOf([entries[2].account])) as bigint, entries[2].amount);
  });

  // ----- signature path: negative cases -----

  it("claimWithSignature reverts InvalidSignature when signed by a non-admin key", async function () {
    const { airdrop, alice, dave } = await deployFixture();
    const amount = parseEther("50");

    // alice (not the admin signer) signs dave's claim.
    const { v, r, s } = await signAirdropClaim(alice, getAddress(dave.account.address), amount);

    await viem.assertions.revertWithCustomError(
      airdrop.write.claimWithSignature([amount, v, r, s], { account: dave.account }),
      airdrop,
      "InvalidSignature",
    );
  });

  it("claimWithSignature reverts InvalidSignature when the amount differs from what was signed", async function () {
    const { airdrop, signer, dave } = await deployFixture();

    const { v, r, s } = await signAirdropClaim(
      signer,
      getAddress(dave.account.address),
      parseEther("50"),
    );

    await viem.assertions.revertWithCustomError(
      airdrop.write.claimWithSignature([parseEther("60"), v, r, s], { account: dave.account }),
      airdrop,
      "InvalidSignature",
    );
  });

  it("claimWithSignature reverts InvalidSignature when another account submits a signature minted for someone else", async function () {
    const { airdrop, signer, dave, bob } = await deployFixture();
    const amount = parseEther("50");

    // Admin authorizes dave, but bob tries to use the signature.
    const { v, r, s } = await signAirdropClaim(signer, getAddress(dave.account.address), amount);

    await viem.assertions.revertWithCustomError(
      airdrop.write.claimWithSignature([amount, v, r, s], { account: bob.account }),
      airdrop,
      "InvalidSignature",
    );
  });

  // ----- the two paths share hasClaimed -----

  it("a Merkle claim blocks the signature path for the same account", async function () {
    const { entries, tree, airdrop, signer, alice } = await deployFixture();

    await airdrop.write.claim([entries[0].amount, tree.getProof(0)], { account: alice.account });

    const { v, r, s } = await signAirdropClaim(
      signer,
      getAddress(alice.account.address),
      entries[0].amount,
    );
    await viem.assertions.revertWithCustomError(
      airdrop.write.claimWithSignature([entries[0].amount, v, r, s], { account: alice.account }),
      airdrop,
      "AlreadyClaimed",
    );
  });

  it("a signature claim blocks the Merkle path for the same account", async function () {
    const { entries, tree, airdrop, signer, eve } = await deployFixture();
    const eveAddr = getAddress(eve.account.address); // eve is entry 3, amount 50

    const { v, r, s } = await signAirdropClaim(signer, eveAddr, entries[3].amount);
    await airdrop.write.claimWithSignature([entries[3].amount, v, r, s], { account: eve.account });

    await viem.assertions.revertWithCustomError(
      airdrop.write.claim([entries[3].amount, tree.getProof(3)], { account: eve.account }),
      airdrop,
      "AlreadyClaimed",
    );
  });
});
