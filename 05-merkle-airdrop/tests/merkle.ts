// Merkle tree utilities for the airdrop. Implement so proofs verify against your contract.

import { keccak256, encodePacked, concat, type Address, type Hex } from "viem";

export interface AirdropEntry {
  account: Address;
  amount: bigint;
}

// keccak256(abi.encodePacked(account, amount)) — matches MerkleAirdrop's leaf.
export function hashLeaf(entry: AirdropEntry): Hex {
  return keccak256(encodePacked(["address", "uint256"], [entry.account, entry.amount]));
}

// Commutative node hash: keccak256 of the two children concatenated smaller-first.
function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) <= BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export class MerkleTree {
  // layers[0] = leaves, layers[last] = [root]. Original entry order preserved.
  private readonly layers: Hex[][];

  constructor(entries: AirdropEntry[]) {
    if (entries.length === 0) throw new Error("MerkleTree: no entries");

    let level = entries.map(hashLeaf);
    this.layers = [level];

    while (level.length > 1) {
      const next: Hex[] = [];
      for (let i = 0; i < level.length; i += 2) {
        // Odd node out: carry it up unchanged.
        next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
      }
      this.layers.push(next);
      level = next;
    }
  }

  get root(): Hex {
    return this.layers[this.layers.length - 1][0];
  }

  // Sibling hashes bottom-up for entries[index]. A carried (odd, sibling-less)
  // node contributes nothing — it just rises to the next layer.
  getProof(index: number): Hex[] {
    if (index < 0 || index >= this.layers[0].length) throw new Error("MerkleTree: index out of range");

    const proof: Hex[] = [];
    let idx = index;
    for (let level = 0; level < this.layers.length - 1; level++) {
      const layer = this.layers[level];
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (siblingIdx < layer.length) proof.push(layer[siblingIdx]);
      idx = Math.floor(idx / 2);
    }
    return proof;
  }
}
