// Merkle tree utilities for the airdrop. Implement so proofs verify against your contract.

import { keccak256, encodePacked, concat, type Address, type Hex } from "viem";

export interface AirdropEntry {
  account: Address;
  amount: bigint;
}

export function hashLeaf(entry: AirdropEntry): Hex {
  return keccak256(encodePacked(["address", "uint256"], [entry.account, entry.amount]));
}

// hash two nodes, smaller first so it matches the contract's ordering
function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export class MerkleTree {
  layers: Hex[][];

  constructor(entries: AirdropEntry[]) {
    this.layers = [entries.map(hashLeaf)];

    let current = this.layers[0];
    while (current.length > 1) {
      const next: Hex[] = [];
      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 < current.length) {
          next.push(hashPair(current[i], current[i + 1]));
        } else {
          next.push(current[i]); // odd one out, carry it up
        }
      }
      this.layers.push(next);
      current = next;
    }
  }

  get root(): Hex {
    return this.layers[this.layers.length - 1][0];
  }

  getProof(index: number): Hex[] {
    const proof: Hex[] = [];
    let i = index;
    for (let level = 0; level < this.layers.length - 1; level++) {
      const layer = this.layers[level];
      const sibling = i % 2 === 0 ? i + 1 : i - 1;
      if (sibling < layer.length) {
        proof.push(layer[sibling]);
      }
      i = Math.floor(i / 2);
    }
    return proof;
  }
}
