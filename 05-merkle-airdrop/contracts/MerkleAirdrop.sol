// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// MerkleAirdrop — claim ERC-20 tokens, proving eligibility two independent ways:
// a Merkle proof against an on-chain root, or a signature from a trusted admin.
// The hashing and recovery are done by hand here (no MerkleProof / ECDSA imports).
//
// Reflection:
//  * The signed message binds the claimant's address. If the admin signed only
//    the amount, the signature wouldn't be tied to anyone — any address could
//    submit it and drain an allocation meant for someone else. Encoding
//    msg.sender's address makes a given signature usable by exactly one account.
//  * Nothing here stops replaying a signature against a *second* deployment: the
//    message has no domain. The same (account, amount) signature verifies on any
//    MerkleAirdrop sharing this signer. Binding the contract address and chainId
//    into the message (i.e. an EIP-712 domain separator) would prevent it.
contract MerkleAirdrop {
    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;
    address public immutable signer;

    mapping(address => bool) public hasClaimed;

    error AlreadyClaimed();
    error InvalidProof();
    error InvalidSignature();

    event Claimed(address indexed account, uint256 amount);

    constructor(IERC20 _token, bytes32 _merkleRoot, address _signer) {
        token = _token;
        merkleRoot = _merkleRoot;
        signer = _signer;
    }

    // Prove membership in the Merkle list and claim `amount`.
    function claim(uint256 amount, bytes32[] calldata proof) external {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        if (!_verify(proof, leaf)) revert InvalidProof();

        _settle(msg.sender, amount);
    }

    // Present an admin signature over (msg.sender, amount) and claim `amount`.
    function claimWithSignature(uint256 amount, uint8 v, bytes32 r, bytes32 s) external {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, amount));
        bytes32 signedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        address recovered = ecrecover(signedHash, v, r, s);
        if (recovered == address(0) || recovered != signer) revert InvalidSignature();

        _settle(msg.sender, amount);
    }

    // Mark claimed and pay out (effects before interaction).
    function _settle(address account, uint256 amount) private {
        hasClaimed[account] = true;
        emit Claimed(account, amount);
        token.transfer(account, amount);
    }

    // Fold the proof into the leaf with sorted-pair hashing and check the root.
    function _verify(bytes32[] calldata proof, bytes32 leaf) private view returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            computed = uint256(computed) <= uint256(sibling)
                ? keccak256(abi.encodePacked(computed, sibling))
                : keccak256(abi.encodePacked(sibling, computed));
        }
        return computed == merkleRoot;
    }
}
