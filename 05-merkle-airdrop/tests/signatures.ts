// Signing helper for claimWithSignature. Implement so the produced signature is accepted by your contract.

import { keccak256, encodePacked, type WalletClient, type Address } from "viem";

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
  const messageHash = keccak256(encodePacked(["address", "uint256"], [claimant, amount]));

  // personal_sign adds the "\x19Ethereum Signed Message:\n32" prefix, same as the contract
  const sig = await signerWallet.signMessage({
    account: signerWallet.account!,
    message: { raw: messageHash },
  });

  // 65 byte signature = r (32) + s (32) + v (1)
  const r = `0x${sig.slice(2, 66)}` as `0x${string}`;
  const s = `0x${sig.slice(66, 130)}` as `0x${string}`;
  const v = parseInt(sig.slice(130, 132), 16);

  return { v, r, s };
}
