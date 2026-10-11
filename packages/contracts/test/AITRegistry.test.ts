import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, keccak256, toHex, zeroAddress } from "viem";

const { viem, networkHelpers } = await network.create();

const aiId = (n: string) => keccak256(toHex(`ai-${n}`));
const DAY = 24n * 60n * 60n;

async function deploy() {
  const [admin, relayer, alice, bob, carol, stranger] = await viem.getWalletClients();
  const registry = await viem.deployContract("AITRegistry", [admin.account.address]);
  await registry.write.grantRole([await registry.read.MINTER_ROLE(), relayer.account.address]);
  const asRelayer = { account: relayer.account };
  // Alice's AI is minted to her with a 5% creator royalty.
  await registry.write.mint([alice.account.address, aiId("alice"), "bafy-alice-v1", 500n], asRelayer);
  return { registry, admin, relayer, alice, bob, carol, stranger, asRelayer };
}

const fixture = () => networkHelpers.loadFixture(deploy);

describe("AITRegistry: identity", () => {
  it("mints one token per AI to its creator, with version 1 and its manifest", async () => {
    const { registry, alice } = await fixture();
    assert.equal(await registry.read.ownerOf([1n]), getAddress(alice.account.address));
    assert.equal(await registry.read.creatorOf([1n]), getAddress(alice.account.address));
    assert.equal(await registry.read.tokenOfAi([aiId("alice")]), 1n);
    assert.equal(await registry.read.tokenURI([1n]), "ipfs://bafy-alice-v1");
    const identity = await registry.read.identityOf([1n]);
    assert.equal(identity.version, 1n);
    assert.equal(identity.aiId, aiId("alice"));
    assert.equal(identity.suspended, false);
  });

  it("emits AIMinted and the first VersionPublished", async () => {
    const { registry, bob, asRelayer } = await fixture();
    await viem.assertions.emitWithArgs(
      registry.write.mint([bob.account.address, aiId("bob"), "bafy-bob-v1", 300n], asRelayer),
      registry,
      "AIMinted",
      [2n, aiId("bob"), getAddress(bob.account.address), "bafy-bob-v1", 300n],
    );
  });

  it("only ALT's minter can mint; nobody can choose someone else as creator", async () => {
    const { registry, stranger, bob } = await fixture();
    await viem.assertions.revertWithCustomError(
      registry.write.mint([bob.account.address, aiId("x"), "bafy-x", 0n], { account: stranger.account }),
      registry,
      "AccessControlUnauthorizedAccount",
    );
  });

  it("refuses a second token for the same AI, a reused manifest, a zero id, an empty manifest and royalties above 10%", async () => {
    const { registry, bob, asRelayer } = await fixture();
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.mint([bob.account.address, aiId("alice"), "bafy-other", 0n], asRelayer),
      registry,
      "AIAlreadyMinted",
      [aiId("alice")],
    );
    await viem.assertions.revertWithCustomError(
      registry.write.mint([bob.account.address, aiId("bob"), "bafy-alice-v1", 0n], asRelayer),
      registry,
      "ManifestAlreadyUsed",
    );
    await viem.assertions.revertWithCustomError(
      registry.write.mint([bob.account.address, toHex(0, { size: 32 }), "bafy-z", 0n], asRelayer),
      registry,
      "InvalidAiId",
    );
    await viem.assertions.revertWithCustomError(registry.write.mint([bob.account.address, aiId("bob"), "", 0n], asRelayer), registry, "EmptyManifest");
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.mint([bob.account.address, aiId("bob"), "bafy-bob", 1_001n], asRelayer),
      registry,
      "RoyaltyTooHigh",
      [1_001n],
    );
  });

  it("pays the creator's royalty through ERC-2981, and the creator stays the creator after a sale", async () => {
    const { registry, alice, bob } = await fixture();
    const [receiver, amount] = await registry.read.royaltyInfo([1n, 10_000n]);
    assert.equal(receiver, getAddress(alice.account.address));
    assert.equal(amount, 500n);
    await registry.write.transferFrom([alice.account.address, bob.account.address, 1n], { account: alice.account });
    assert.equal(await registry.read.ownerOf([1n]), getAddress(bob.account.address));
    assert.equal(await registry.read.creatorOf([1n]), getAddress(alice.account.address));
    assert.equal((await registry.read.royaltyInfo([1n, 10_000n]))[0], getAddress(alice.account.address));
  });

  it("supports ERC-721, ERC-2981 and ERC-4907", async () => {
    const { registry } = await fixture();
    assert.equal(await registry.read.supportsInterface(["0x80ac58cd"]), true);
    assert.equal(await registry.read.supportsInterface(["0x2a55205a"]), true);
    assert.equal(await registry.read.supportsInterface(["0xad092b5c"]), true);
  });
});

describe("AITRegistry: versions", () => {
  it("lets the owner or ALT's relayer publish new versions, and nobody else", async () => {
    const { registry, alice, stranger, asRelayer } = await fixture();
    await viem.assertions.emitWithArgs(registry.write.publishVersion([1n, "bafy-alice-v2"], { account: alice.account }), registry, "VersionPublished", [
      1n,
      2n,
      "bafy-alice-v2",
    ]);
    await registry.write.publishVersion([1n, "bafy-alice-v3"], asRelayer);
    assert.equal((await registry.read.identityOf([1n])).version, 3n);
    assert.equal(await registry.read.tokenURI([1n]), "ipfs://bafy-alice-v3");
    await viem.assertions.revertWithCustomError(
      registry.write.publishVersion([1n, "bafy-evil"], { account: stranger.account }),
      registry,
      "NotOwnerOrMinter",
    );
    await viem.assertions.revertWithCustomError(
      registry.write.publishVersion([1n, "bafy-alice-v2"], { account: alice.account }),
      registry,
      "ManifestAlreadyUsed",
    );
  });
});

describe("AITRegistry: governance", () => {
  it("a suspended AI cannot move, be rented or be updated until a governor lifts it", async () => {
    const { registry, admin, alice, bob, stranger } = await fixture();
    await viem.assertions.revertWithCustomError(
      registry.write.suspend([1n, "spam"], { account: stranger.account }),
      registry,
      "AccessControlUnauthorizedAccount",
    );
    await viem.assertions.emitWithArgs(registry.write.suspend([1n, "policy violation"], { account: admin.account }), registry, "Suspended", [
      1n,
      "policy violation",
    ]);
    assert.equal(await registry.read.isSuspended([1n]), true);
    await viem.assertions.revertWithCustomError(
      registry.write.transferFrom([alice.account.address, bob.account.address, 1n], { account: alice.account }),
      registry,
      "TokenIsSuspended",
    );
    await viem.assertions.revertWithCustomError(
      registry.write.publishVersion([1n, "bafy-new"], { account: alice.account }),
      registry,
      "TokenIsSuspended",
    );
    await viem.assertions.revertWithCustomError(
      registry.write.setUser([1n, bob.account.address, 9_999_999_999n], { account: alice.account }),
      registry,
      "TokenIsSuspended",
    );
    await registry.write.unsuspend([1n], { account: admin.account });
    await registry.write.transferFrom([alice.account.address, bob.account.address, 1n], { account: alice.account });
  });
});

describe("AITRegistry: rentals (ERC-4907)", () => {
  it("gives the renter use until expiry, after which access ends by itself", async () => {
    const { registry, alice, bob } = await fixture();
    const now = BigInt(await networkHelpers.time.latest());
    await registry.write.setUser([1n, bob.account.address, now + DAY], { account: alice.account });
    assert.equal(await registry.read.userOf([1n]), getAddress(bob.account.address));
    assert.equal(await registry.read.ownerOf([1n]), getAddress(alice.account.address));
    await networkHelpers.time.increase(Number(DAY) + 1);
    assert.equal(await registry.read.userOf([1n]), zeroAddress);
  });

  it("an active rental cannot be replaced, and the AI cannot be transferred out from under the renter", async () => {
    const { registry, alice, bob, carol } = await fixture();
    const now = BigInt(await networkHelpers.time.latest());
    await registry.write.setUser([1n, bob.account.address, now + DAY], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      registry.write.setUser([1n, carol.account.address, now + 2n * DAY], { account: alice.account }),
      registry,
      "TokenIsRented",
    );
    await viem.assertions.revertWithCustomError(
      registry.write.transferFrom([alice.account.address, carol.account.address, 1n], { account: alice.account }),
      registry,
      "TokenIsRented",
    );
    await networkHelpers.time.increase(Number(DAY) + 1);
    await viem.assertions.emitWithArgs(
      registry.write.transferFrom([alice.account.address, carol.account.address, 1n], { account: alice.account }),
      registry,
      "UpdateUser",
      [1n, zeroAddress, 0n],
    );
    assert.equal(await registry.read.userExpires([1n]), 0n);
  });

  it("only the owner or an approved operator can set the user", async () => {
    const { registry, bob, stranger } = await fixture();
    await viem.assertions.revertWithCustomError(
      registry.write.setUser([1n, bob.account.address, 9_999_999_999n], { account: stranger.account }),
      registry,
      "NotAuthorized",
    );
  });
});
