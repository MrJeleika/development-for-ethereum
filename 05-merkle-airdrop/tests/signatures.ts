// Signing helper for claimWithSignature. Implement so the produced signature is accepted by your contract.

import { keccak256, encodePacked, parseSignature, type WalletClient, type Address } from "viem";

export interface ClaimSignatureParts {
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

export async function signAirdropClaim(
  signerWallet: WalletClient,
  claimant: Address,
  amount: bigint,
): Promise<ClaimSignatureParts> {
  // Same message the contract reconstructs: keccak256(abi.encodePacked(account, amount)).
  const messageHash = keccak256(encodePacked(["address", "uint256"], [claimant, amount]));

  // Personal-sign over the raw 32-byte hash: the wallet prefixes
  // "\x19Ethereum Signed Message:\n32" before hashing, exactly as the contract does.
  const signature = await signerWallet.signMessage({
    account: signerWallet.account!,
    message: { raw: messageHash },
  });

  const sig = parseSignature(signature);
  const v = sig.v !== undefined ? Number(sig.v) : 27 + sig.yParity;
  return { v, r: sig.r, s: sig.s };
}
