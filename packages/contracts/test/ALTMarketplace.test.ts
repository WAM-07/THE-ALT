import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, keccak256, parseEther, toHex, zeroAddress } from "viem";

const { viem, networkHelpers } = await network.create();

const aiId = (n: string) => keccak256(toHex(`ai-${n}`));
const DAY = 24 * 60 * 60;
const FEE_BPS = 250n; // 2.5% platform fee
const ROYALTY_BPS = 500n; // 5% creator royalty

async function deploy() {
  const [admin, relayer, alice, bob, carol, dave, treasury] = await viem.getWalletClients();
  const registry = await viem.deployContract("AITRegistry", [admin.account.address]);
  await registry.write.grantRole([await registry.read.MINTER_ROLE(), relayer.account.address]);
  const market = await viem.deployContract("ALTMarketplace", [registry.address, treasury.account.address, FEE_BPS, admin.account.address]);
  // Alice creates AI #1 (5% royalty) and approves the marketplace to move her AITs.
  await registry.write.mint([alice.account.address, aiId("alice"), "bafy-alice", ROYALTY_BPS], { account: relayer.account });
  await registry.write.setApprovalForAll([market.address, true], { account: alice.account });
  await registry.write.setApprovalForAll([market.address, true], { account: bob.account });
  return { registry, market, admin, relayer, alice, bob, carol, dave, treasury };
}

const fixture = () => networkHelpers.loadFixture(deploy);
const as = (w: { account: { address: `0x${string}` } }) => ({ account: w.account as never });

describe("ALTMarketplace: listing", () => {
  it("only the owner can list, the marketplace must be approved, and the price must be positive", async () => {
    const { market, registry, alice, bob, relayer } = await fixture();
    await viem.assertions.revertWithCustomError(market.write.listForSale([1n, parseEther("1")], as(bob)), market, "NotTokenOwner");
    await viem.assertions.revertWithCustomError(market.write.listForSale([1n, 0n], as(alice)), market, "InvalidPrice");

    await registry.write.mint([bob.account.address, aiId("bob"), "bafy-bob", 0n], { account: relayer.account });
    await registry.write.setApprovalForAll([market.address, false], as(bob));
    await viem.assertions.revertWithCustomError(market.write.listForSale([2n, parseEther("1")], as(bob)), market, "MarketplaceNotApproved");

    await viem.assertions.emitWithArgs(market.write.listForSale([1n, parseEther("1")], as(alice)), market, "ListedForSale", [
      1n,
      getAddress(alice.account.address),
      parseEther("1"),
    ]);
  });
});

describe("ALTMarketplace: sales and royalties", () => {
  it("a creator's first sale pays no royalty: fee to the treasury, the rest to the creator", async () => {
    const { market, registry, alice, bob, treasury } = await fixture();
    const price = parseEther("1");
    await market.write.listForSale([1n, price], as(alice));
    await market.write.buy([1n], { ...as(bob), value: price });

    assert.equal(await registry.read.ownerOf([1n]), getAddress(bob.account.address));
    const fee = (price * FEE_BPS) / 10_000n;
    assert.equal(await market.read.balances([treasury.account.address]), fee);
    assert.equal(await market.read.balances([alice.account.address]), price - fee);
    assert.deepEqual(await market.read.sales([1n]), [zeroAddress, 0n]);
  });

  it("a resale pays the original creator a royalty automatically", async () => {
    const { market, alice, bob, carol, treasury } = await fixture();
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await market.write.buy([1n], { ...as(bob), value: parseEther("1") });
    const aliceAfterFirst = await market.read.balances([alice.account.address]);

    const resale = parseEther("2");
    await market.write.listForSale([1n, resale], as(bob));
    await viem.assertions.emitWithArgs(market.write.buy([1n], { ...as(carol), value: resale }), market, "Sold", [
      1n,
      getAddress(bob.account.address),
      getAddress(carol.account.address),
      resale,
      getAddress(alice.account.address),
      (resale * ROYALTY_BPS) / 10_000n,
      (resale * FEE_BPS) / 10_000n,
    ]);
    const royalty = (resale * ROYALTY_BPS) / 10_000n;
    const fee = (resale * FEE_BPS) / 10_000n;
    assert.equal(await market.read.balances([alice.account.address]), aliceAfterFirst + royalty);
    assert.equal(await market.read.balances([bob.account.address]), resale - royalty - fee);
    assert.equal(await market.read.balances([treasury.account.address]), (parseEther("1") * FEE_BPS) / 10_000n + fee);
  });

  it("requires the exact price: no underpayment and no overpayment left in the contract", async () => {
    const { market, alice, bob } = await fixture();
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await viem.assertions.revertWithCustomErrorWithArgs(market.write.buy([1n], { ...as(bob), value: parseEther("0.5") }), market, "WrongPayment", [
      parseEther("1"),
      parseEther("0.5"),
    ]);
    await viem.assertions.revertWithCustomError(market.write.buy([1n], { ...as(bob), value: parseEther("1.5") }), market, "WrongPayment");
  });

  it("a listing goes stale when the seller no longer owns the AI; anyone can clear it", async () => {
    const { market, registry, alice, bob, carol, dave } = await fixture();
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await registry.write.transferFrom([alice.account.address, dave.account.address, 1n], as(alice));
    await viem.assertions.revertWithCustomError(market.write.buy([1n], { ...as(bob), value: parseEther("1") }), market, "StaleListing");
    await market.write.cancelSale([1n], as(carol));
    await viem.assertions.revertWithCustomError(market.write.buy([1n], { ...as(bob), value: parseEther("1") }), market, "NotListed");
  });

  it("only the seller can cancel a live listing", async () => {
    const { market, alice, bob } = await fixture();
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await viem.assertions.revertWithCustomError(market.write.cancelSale([1n], as(bob)), market, "NotTokenOwner");
    await viem.assertions.emitWithArgs(market.write.cancelSale([1n], as(alice)), market, "SaleCancelled", [1n]);
  });

  it("cannot buy your own AI, a suspended AI, or an AI someone is renting", async () => {
    const { market, registry, admin, alice, bob, carol } = await fixture();
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await viem.assertions.revertWithCustomError(market.write.buy([1n], { ...as(alice), value: parseEther("1") }), market, "CannotBuyOwnToken");

    await registry.write.suspend([1n, "dispute"], as(admin));
    await viem.assertions.revertWithCustomError(market.write.buy([1n], { ...as(bob), value: parseEther("1") }), market, "TokenSuspended");
    await registry.write.unsuspend([1n], as(admin));

    await market.write.listForRent([1n, parseEther("0.1"), 7], as(alice));
    await market.write.rent([1n, 3], { ...as(carol), value: parseEther("0.3") });
    await viem.assertions.revertWithCustomError(market.write.buy([1n], { ...as(bob), value: parseEther("1") }), market, "TokenRented");
  });
});

describe("ALTMarketplace: rentals", () => {
  it("the renter can use the AI until expiry; ownership never moves; access ends automatically", async () => {
    const { market, registry, alice, carol } = await fixture();
    await market.write.listForRent([1n, parseEther("0.1"), 30], as(alice));
    await market.write.rent([1n, 2], { ...as(carol), value: parseEther("0.2") });
    assert.equal(await registry.read.userOf([1n]), getAddress(carol.account.address));
    assert.equal(await registry.read.ownerOf([1n]), getAddress(alice.account.address));

    await networkHelpers.time.increase(2 * DAY + 1);
    assert.equal(await registry.read.userOf([1n]), zeroAddress);
  });

  it("splits rent between owner, creator (when they differ) and treasury", async () => {
    const { market, alice, bob, carol, treasury } = await fixture();
    // Bob buys Alice's AI, then rents it out: Alice (creator) earns a royalty on Bob's rental income.
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await market.write.buy([1n], { ...as(bob), value: parseEther("1") });
    const aliceBefore = await market.read.balances([alice.account.address]);
    const treasuryBefore = await market.read.balances([treasury.account.address]);

    await market.write.listForRent([1n, parseEther("0.1"), 30], as(bob));
    const total = parseEther("0.5");
    await market.write.rent([1n, 5], { ...as(carol), value: total });
    const royalty = (total * ROYALTY_BPS) / 10_000n;
    const fee = (total * FEE_BPS) / 10_000n;
    assert.equal(await market.read.balances([alice.account.address]), aliceBefore + royalty);
    assert.equal(await market.read.balances([treasury.account.address]), treasuryBefore + fee);
    assert.equal(await market.read.balances([bob.account.address]), total - royalty - fee);
  });

  it("refuses overlapping rentals, wrong durations and wrong payment", async () => {
    const { market, alice, carol, dave } = await fixture();
    await market.write.listForRent([1n, parseEther("0.1"), 7], as(alice));
    await viem.assertions.revertWithCustomError(market.write.rent([1n, 0], { ...as(carol), value: 0n }), market, "InvalidDuration");
    await viem.assertions.revertWithCustomError(market.write.rent([1n, 8], { ...as(carol), value: parseEther("0.8") }), market, "InvalidDuration");
    await viem.assertions.revertWithCustomError(market.write.rent([1n, 2], { ...as(carol), value: parseEther("0.1") }), market, "WrongPayment");
    await market.write.rent([1n, 2], { ...as(carol), value: parseEther("0.2") });
    await viem.assertions.revertWithCustomError(market.write.rent([1n, 1], { ...as(dave), value: parseEther("0.1") }), market, "TokenRented");
    await networkHelpers.time.increase(2 * DAY + 1);
    await market.write.rent([1n, 1], { ...as(dave), value: parseEther("0.1") });
  });

  it("rental terms are cleared when the AI is sold", async () => {
    const { market, alice, bob } = await fixture();
    await market.write.listForRent([1n, parseEther("0.1"), 7], as(alice));
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await market.write.buy([1n], { ...as(bob), value: parseEther("1") });
    assert.deepEqual(await market.read.rentalOffers([1n]), [zeroAddress, 0n, 0]);
  });
});

describe("ALTMarketplace: payouts and safety", () => {
  it("people withdraw what they earned (pull payments)", async () => {
    const { market, alice, bob } = await fixture();
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await market.write.buy([1n], { ...as(bob), value: parseEther("1") });
    const owed = await market.read.balances([alice.account.address]);
    await viem.assertions.balancesHaveChanged(market.write.withdraw(as(alice)), [{ address: market.address, amount: -owed }]);
    assert.equal(await market.read.balances([alice.account.address]), 0n);
    await viem.assertions.revertWithCustomError(market.write.withdraw(as(alice)), market, "NothingToWithdraw");
  });

  it("a recipient that rejects payments cannot block a sale; it only fails its own withdrawal", async () => {
    const { market, registry, relayer, bob } = await fixture();
    const rejecting = await viem.deployContract("RejectingReceiver");
    await registry.write.mint([rejecting.address, aiId("rej"), "bafy-rej", 0n], { account: relayer.account });
    await rejecting.write.approveAndList([registry.address, market.address, 2n, parseEther("1")]);
    await market.write.buy([2n], { ...as(bob), value: parseEther("1") });
    assert.equal(await registry.read.ownerOf([2n]), getAddress(bob.account.address));
    await viem.assertions.revertWithCustomError(rejecting.write.withdrawFrom([market.address]), market, "WithdrawFailed");
  });

  it("blocks re-entrancy from a malicious buyer contract", async () => {
    const { market, registry, relayer, alice, bob } = await fixture();
    await registry.write.mint([bob.account.address, aiId("bob"), "bafy-bob", 0n], { account: relayer.account });
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await market.write.listForSale([2n, parseEther("1")], as(bob));
    const attacker = await viem.deployContract("ReentrantBuyer", [market.address]);
    await viem.assertions.revertWithCustomError(
      attacker.write.attack([1n, 2n, parseEther("1")], { value: parseEther("2") }),
      market,
      "ReentrancyGuardReentrantCall",
    );
    assert.equal(await registry.read.ownerOf([1n]), getAddress(alice.account.address));
  });

  it("only the admin can change the fee, and never above 10%", async () => {
    const { market, admin, bob } = await fixture();
    await viem.assertions.revertWithCustomError(market.write.setPlatformFee([100n], as(bob)), market, "OwnableUnauthorizedAccount");
    await viem.assertions.revertWithCustomError(market.write.setPlatformFee([1_001n], as(admin)), market, "FeeTooHigh");
    await market.write.setPlatformFee([100n], as(admin));
    assert.equal(await market.read.platformFeeBps(), 100n);
  });
});

describe("ALTMarketplace: guards", () => {
  it("cannot be deployed with a zero registry or treasury, or a fee above 10%", async () => {
    const { registry, admin, treasury } = await fixture();
    // A deployed instance only provides the ABI used to decode the custom errors.
    const probe = await viem.deployContract("ALTMarketplace", [registry.address, treasury.account.address, 0n, admin.account.address]);
    await viem.assertions.revertWithCustomError(
      viem.deployContract("ALTMarketplace", [zeroAddress, treasury.account.address, 0n, admin.account.address]),
      probe,
      "ZeroAddress",
    );
    await viem.assertions.revertWithCustomError(
      viem.deployContract("ALTMarketplace", [registry.address, treasury.account.address, 1_001n, admin.account.address]),
      probe,
      "FeeTooHigh",
    );
  });

  it("validates rental offers and lets only the owner cancel a live one", async () => {
    const { market, alice, bob, carol } = await fixture();
    await viem.assertions.revertWithCustomError(market.write.listForRent([1n, 0n, 7], as(alice)), market, "InvalidPrice");
    await viem.assertions.revertWithCustomError(market.write.listForRent([1n, 1n, 0], as(alice)), market, "InvalidDuration");
    await viem.assertions.revertWithCustomError(market.write.listForRent([1n, 1n, 366], as(alice)), market, "InvalidDuration");
    await viem.assertions.revertWithCustomError(market.write.cancelRentalOffer([1n], as(alice)), market, "NotListed");
    await viem.assertions.revertWithCustomError(market.write.cancelSale([1n], as(alice)), market, "NotListed");
    await viem.assertions.revertWithCustomError(market.write.rent([1n, 1], { ...as(carol), value: 1n }), market, "NotListed");

    await market.write.listForRent([1n, parseEther("0.1"), 7], as(alice));
    await viem.assertions.revertWithCustomError(market.write.cancelRentalOffer([1n], as(bob)), market, "NotTokenOwner");
    await viem.assertions.emitWithArgs(market.write.cancelRentalOffer([1n], as(alice)), market, "RentalOfferCancelled", [1n]);
  });

  it("refuses stale, self and suspended rentals", async () => {
    const { market, registry, admin, alice, carol, dave } = await fixture();
    await market.write.listForRent([1n, parseEther("0.1"), 7], as(alice));
    await viem.assertions.revertWithCustomError(market.write.rent([1n, 1], { ...as(alice), value: parseEther("0.1") }), market, "CannotBuyOwnToken");
    await registry.write.suspend([1n, "review"], as(admin));
    await viem.assertions.revertWithCustomError(market.write.rent([1n, 1], { ...as(carol), value: parseEther("0.1") }), market, "TokenSuspended");
    await viem.assertions.revertWithCustomError(market.write.listForSale([1n, 1n], as(alice)), market, "TokenSuspended");
    await registry.write.unsuspend([1n], as(admin));
    await registry.write.transferFrom([alice.account.address, dave.account.address, 1n], as(alice));
    await viem.assertions.revertWithCustomError(market.write.rent([1n, 1], { ...as(carol), value: parseEther("0.1") }), market, "StaleListing");
    await market.write.cancelRentalOffer([1n], as(carol)); // stale offers can be cleared by anyone
  });

  it("only the admin can move the treasury, never to the zero address", async () => {
    const { market, admin, bob } = await fixture();
    await viem.assertions.revertWithCustomError(market.write.setTreasury([bob.account.address], as(bob)), market, "OwnableUnauthorizedAccount");
    await viem.assertions.revertWithCustomError(market.write.setTreasury([zeroAddress], as(admin)), market, "ZeroAddress");
    await viem.assertions.emitWithArgs(market.write.setTreasury([bob.account.address], as(admin)), market, "TreasuryUpdated", [getAddress(bob.account.address)]);
  });

  it("works with per-token approval as well as approval-for-all", async () => {
    const { market, registry, relayer, carol, dave } = await fixture();
    await registry.write.mint([carol.account.address, aiId("carol"), "bafy-carol", 0n], { account: relayer.account });
    await registry.write.approve([market.address, 2n], as(carol));
    await market.write.listForSale([2n, parseEther("1")], as(carol));
    await market.write.buy([2n], { ...as(dave), value: parseEther("1") });
    assert.equal(await registry.read.ownerOf([2n]), getAddress(dave.account.address));
  });
});

describe("ALTMarketplace: subscriptions", () => {
  const MONTH = 30 * DAY;

  it("many people subscribe at once; each pays the owner (minus fee) and may use it for the months paid", async () => {
    const { market, registry, alice, carol, dave, treasury } = await fixture();
    await market.write.listForSubscription([1n, parseEther("0.3")], as(alice));
    await market.write.subscribe([1n, 1], { ...as(carol), value: parseEther("0.3") });
    await market.write.subscribe([1n, 2], { ...as(dave), value: parseEther("0.6") });
    assert.equal(await market.read.isSubscribed([1n, carol.account.address]), true);
    assert.equal(await market.read.isSubscribed([1n, dave.account.address]), true);
    // Ownership never moves, and nobody becomes the ERC-4907 user.
    assert.equal(await registry.read.ownerOf([1n]), getAddress(alice.account.address));
    assert.equal(await registry.read.userOf([1n]), zeroAddress);
    // The creator is the owner here, so no royalty: fee to the treasury, the rest to Alice.
    const total = parseEther("0.9");
    assert.equal(await market.read.balances([treasury.account.address]), (total * FEE_BPS) / 10_000n);
    assert.equal(await market.read.balances([alice.account.address]), total - (total * FEE_BPS) / 10_000n);

    await networkHelpers.time.increase(MONTH + 1);
    assert.equal(await market.read.isSubscribed([1n, carol.account.address]), false);
    assert.equal(await market.read.isSubscribed([1n, dave.account.address]), true);
  });

  it("renewing adds to the time left instead of starting again", async () => {
    const { market, alice, carol } = await fixture();
    await market.write.listForSubscription([1n, parseEther("0.1")], as(alice));
    await market.write.subscribe([1n, 1], { ...as(carol), value: parseEther("0.1") });
    const first = await market.read.subscriptionExpires([1n, carol.account.address]);
    await market.write.subscribe([1n, 2], { ...as(carol), value: parseEther("0.2") });
    assert.equal(await market.read.subscriptionExpires([1n, carol.account.address]), first + BigInt(2 * MONTH));
  });

  it("pays the creator a royalty when someone else's subscribers pay", async () => {
    const { market, alice, bob, carol } = await fixture();
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await market.write.buy([1n], { ...as(bob), value: parseEther("1") });
    const aliceBefore = await market.read.balances([alice.account.address]);
    await market.write.listForSubscription([1n, parseEther("0.2")], as(bob));
    await market.write.subscribe([1n, 1], { ...as(carol), value: parseEther("0.2") });
    assert.equal(await market.read.balances([alice.account.address]), aliceBefore + (parseEther("0.2") * ROYALTY_BPS) / 10_000n);
  });

  it("validates offers, months and payment, and refuses your own AI", async () => {
    const { market, alice, carol } = await fixture();
    await viem.assertions.revertWithCustomError(market.write.listForSubscription([1n, parseEther("0.1")], as(carol)), market, "NotTokenOwner");
    await viem.assertions.revertWithCustomError(market.write.listForSubscription([1n, 0n], as(alice)), market, "InvalidPrice");
    await viem.assertions.revertWithCustomError(market.write.subscribe([1n, 1], { ...as(carol), value: parseEther("0.1") }), market, "NotListed");
    await market.write.listForSubscription([1n, parseEther("0.1")], as(alice));
    await viem.assertions.revertWithCustomError(market.write.subscribe([1n, 0], { ...as(carol), value: 0n }), market, "InvalidDuration");
    await viem.assertions.revertWithCustomError(market.write.subscribe([1n, 13], { ...as(carol), value: parseEther("1.3") }), market, "InvalidDuration");
    await viem.assertions.revertWithCustomError(market.write.subscribe([1n, 2], { ...as(carol), value: parseEther("0.1") }), market, "WrongPayment");
    await viem.assertions.revertWithCustomError(market.write.subscribe([1n, 1], { ...as(alice), value: parseEther("0.1") }), market, "CannotBuyOwnToken");
    await viem.assertions.revertWithCustomError(market.write.cancelSubscriptionOffer([1n], as(carol)), market, "NotTokenOwner");
    await market.write.cancelSubscriptionOffer([1n], as(alice));
    await viem.assertions.revertWithCustomError(market.write.subscribe([1n, 1], { ...as(carol), value: parseEther("0.1") }), market, "NotListed");
  });

  it("a sale clears the seller's price, but subscribers keep the time they paid for", async () => {
    const { market, alice, bob, carol } = await fixture();
    await market.write.listForSubscription([1n, parseEther("0.1")], as(alice));
    await market.write.subscribe([1n, 1], { ...as(carol), value: parseEther("0.1") });
    await market.write.listForSale([1n, parseEther("1")], as(alice));
    await market.write.buy([1n], { ...as(bob), value: parseEther("1") });
    assert.deepEqual(await market.read.subscriptionOffers([1n]), [zeroAddress, 0n]);
    assert.equal(await market.read.isSubscribed([1n, carol.account.address]), true);
  });
});
