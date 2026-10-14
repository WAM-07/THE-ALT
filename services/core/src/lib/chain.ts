import { aitRegistryAbi, altMarketplaceAbi } from '@alt/contracts/abi';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseEventLogs,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AppError } from './errors.js';

export interface ChainConfig {
  rpcUrl: string;
  chainId: number;
  name: string;
  registryAddress: string;
  marketplaceAddress?: string | undefined;
  relayerPrivateKey: string;
  explorerUrl?: string | undefined;
  confirmations: number;
}

/** ALT Core's view of an AI identity token, read from the chain. */
export interface OnChainIdentity {
  tokenId: bigint;
  owner: Address;
  creator: Address;
  version: bigint;
  suspended: boolean;
  manifestCid: string;
  tokenUri: string;
}

/** AIAlreadyMinted -> AI_ALREADY_MINTED */
const constantCase = (name: string) =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toUpperCase();

/** ALT ids are UUIDs; on-chain they are bytes32 (the 16 UUID bytes, left-padded). */
export const aiIdToBytes32 = (uuid: string): Hex => `0x${uuid.replace(/-/g, '').toLowerCase().padStart(64, '0')}`;

/**
 * The blockchain side of ALT Core (Module 17). ALT's relayer account holds MINTER_ROLE on the
 * AITRegistry, so people never need crypto or gas to give their AI a verified identity.
 */
export class ChainService {
  readonly chainId: number;
  readonly name: string;
  readonly registryAddress: Address;
  readonly marketplaceAddress: Address | null;
  readonly relayerAddress: Address;
  private readonly explorerUrl: string | null;
  private readonly rpcUrl: string;
  private readonly confirmations: number;
  private readonly publicClient;
  private readonly walletClient;

  constructor(cfg: ChainConfig) {
    const chain = defineChain({
      id: cfg.chainId,
      name: cfg.name,
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
    });
    const account = privateKeyToAccount(cfg.relayerPrivateKey as Hex);
    this.chainId = cfg.chainId;
    this.name = cfg.name;
    this.registryAddress = getAddress(cfg.registryAddress);
    this.marketplaceAddress = cfg.marketplaceAddress ? getAddress(cfg.marketplaceAddress) : null;
    this.relayerAddress = account.address;
    this.explorerUrl = cfg.explorerUrl?.replace(/\/$/, '') ?? null;
    this.rpcUrl = cfg.rpcUrl;
    this.confirmations = cfg.confirmations;
    this.publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
    this.walletClient = createWalletClient({ chain, account, transport: http(cfg.rpcUrl) });
  }

  explorerTx(hash: string) {
    return this.explorerUrl ? `${this.explorerUrl}/tx/${hash}` : null;
  }

  explorerAddress(address: string) {
    return this.explorerUrl ? `${this.explorerUrl}/address/${address}` : null;
  }

  explorerToken(tokenId: bigint | string) {
    return this.explorerUrl ? `${this.explorerUrl}/token/${this.registryAddress}?a=${tokenId}` : null;
  }

  /** Throws a readable AppError for contract reverts (e.g. AIAlreadyMinted) and RPC failures. */
  private explain(err: unknown, action: string): never {
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        const name = revert.data?.errorName ?? 'Reverted';
        throw new AppError(409, `CHAIN_${constantCase(name)}`, `The blockchain refused to ${action} (${name}).`, {
          errorName: name,
          args: revert.data?.args?.map(String),
        });
      }
      throw new AppError(502, 'CHAIN_UNAVAILABLE', `Could not reach the blockchain to ${action}.`, { reason: err.shortMessage });
    }
    throw err;
  }

  /** What minting will cost and where it goes (shown before the person confirms, M17 FE-2). */
  async previewMint(to: string, aiUuid: string, manifestCid: string, royaltyBps: number) {
    try {
      const args = [getAddress(to), aiIdToBytes32(aiUuid), manifestCid, BigInt(royaltyBps)] as const;
      const [gas, gasPrice] = await Promise.all([
        this.publicClient.estimateContractGas({ address: this.registryAddress, abi: aitRegistryAbi, functionName: 'mint', args, account: this.walletClient.account }),
        this.publicClient.getGasPrice(),
      ]);
      return {
        network: this.name,
        chainId: this.chainId,
        contract: this.registryAddress,
        function: 'mint(address creator, bytes32 aiId, string manifestCid, uint96 royaltyBps)',
        from: this.relayerAddress,
        gasEstimate: gas.toString(),
        gasPriceWei: gasPrice.toString(),
        estimatedCostWei: (gas * gasPrice).toString(),
        paidBy: 'THE ALT (relayer)',
      };
    } catch (err) {
      this.explain(err, 'prepare the mint');
    }
  }

  /** Sends the mint. Returns the transaction hash immediately; confirm with [confirmMint]. */
  async sendMint(to: string, aiUuid: string, manifestCid: string, royaltyBps: number): Promise<Hash> {
    try {
      const { request } = await this.publicClient.simulateContract({
        address: this.registryAddress,
        abi: aitRegistryAbi,
        functionName: 'mint',
        args: [getAddress(to), aiIdToBytes32(aiUuid), manifestCid, BigInt(royaltyBps)],
        account: this.walletClient.account,
      });
      return await this.walletClient.writeContract(request);
    } catch (err) {
      this.explain(err, 'mint the AI identity token');
    }
  }

  /** Waits for the mint to be confirmed and returns the new token id. */
  async confirmMint(hash: Hash) {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash, confirmations: this.confirmations, timeout: 180_000 });
    if (receipt.status !== 'success') throw new AppError(502, 'CHAIN_TX_FAILED', 'The mint transaction failed on-chain.');
    const [minted] = parseEventLogs({ abi: aitRegistryAbi, logs: receipt.logs, eventName: 'AIMinted' });
    if (!minted) throw new AppError(502, 'CHAIN_TX_FAILED', 'The mint transaction did not create a token.');
    return { tokenId: minted.args.tokenId, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
  }

  /** Records a new version's manifest on-chain (the relayer acts for owners whose wallet ALT manages). */
  async publishVersion(tokenId: bigint, manifestCid: string) {
    try {
      const { request } = await this.publicClient.simulateContract({
        address: this.registryAddress,
        abi: aitRegistryAbi,
        functionName: 'publishVersion',
        args: [tokenId, manifestCid],
        account: this.walletClient.account,
      });
      const hash = await this.walletClient.writeContract(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash, confirmations: this.confirmations, timeout: 180_000 });
      if (receipt.status !== 'success') throw new AppError(502, 'CHAIN_TX_FAILED', 'Publishing the version failed on-chain.');
      const [event] = parseEventLogs({ abi: aitRegistryAbi, logs: receipt.logs, eventName: 'VersionPublished' });
      return { hash, version: event?.args.version ?? null, blockNumber: receipt.blockNumber };
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.explain(err, 'publish the new version');
    }
  }

  /** Reads the token's current state straight from the chain (the source of truth). */
  async readIdentity(tokenId: bigint): Promise<OnChainIdentity> {
    try {
      const [owner, identity, tokenUri] = await Promise.all([
        this.publicClient.readContract({ address: this.registryAddress, abi: aitRegistryAbi, functionName: 'ownerOf', args: [tokenId] }),
        this.publicClient.readContract({ address: this.registryAddress, abi: aitRegistryAbi, functionName: 'identityOf', args: [tokenId] }),
        this.publicClient.readContract({ address: this.registryAddress, abi: aitRegistryAbi, functionName: 'tokenURI', args: [tokenId] }),
      ]);
      return {
        tokenId,
        owner,
        creator: identity.creator,
        version: identity.version,
        suspended: identity.suspended,
        manifestCid: identity.manifestCid,
        tokenUri,
      };
    } catch (err) {
      this.explain(err, 'read the AI identity token');
    }
  }

  // ---------------------------------------------------------------- wallets and the marketplace (ALTAR)

  /** Hardhat's local development chain, where ALT may hand out test POL. */
  get isLocalDevChain() {
    return this.chainId === 31337;
  }

  private requireMarket(): Address {
    if (!this.marketplaceAddress) throw new AppError(503, 'MARKETPLACE_DISABLED', 'The marketplace contract is not configured on this server.');
    return this.marketplaceAddress;
  }

  async balanceOf(address: string) {
    try {
      return await this.publicClient.getBalance({ address: getAddress(address) });
    } catch (err) {
      this.explain(err, 'read the wallet balance');
    }
  }

  /** Earnings waiting in the marketplace (sales, rentals, royalties) for this address. */
  async earningsOf(address: string) {
    return this.publicClient.readContract({ address: this.requireMarket(), abi: altMarketplaceAbi, functionName: 'balances', args: [getAddress(address)] });
  }

  async platformFeeBps() {
    return Number(await this.publicClient.readContract({ address: this.requireMarket(), abi: altMarketplaceAbi, functionName: 'platformFeeBps' }));
  }

  /** What the marketplace contract says about a token right now: for sale, for rent, rented. */
  async marketState(tokenId: bigint) {
    const market = this.requireMarket();
    try {
      const [sale, offer, subscription, renter, renterUntil] = await Promise.all([
        this.publicClient.readContract({ address: market, abi: altMarketplaceAbi, functionName: 'sales', args: [tokenId] }),
        this.publicClient.readContract({ address: market, abi: altMarketplaceAbi, functionName: 'rentalOffers', args: [tokenId] }),
        this.publicClient.readContract({ address: market, abi: altMarketplaceAbi, functionName: 'subscriptionOffers', args: [tokenId] }),
        this.publicClient.readContract({ address: this.registryAddress, abi: aitRegistryAbi, functionName: 'userOf', args: [tokenId] }),
        this.publicClient.readContract({ address: this.registryAddress, abi: aitRegistryAbi, functionName: 'userExpires', args: [tokenId] }),
      ]);
      const [seller, price] = sale;
      const [owner, pricePerDay, maxDays] = offer;
      const none = '0x0000000000000000000000000000000000000000';
      return {
        sale: price > 0n ? { seller: seller.toLowerCase(), priceWei: price } : null,
        rent: pricePerDay > 0n ? { owner: owner.toLowerCase(), pricePerDayWei: pricePerDay, maxDays: Number(maxDays) } : null,
        subscription: subscription[1] > 0n ? { owner: subscription[0].toLowerCase(), pricePerMonthWei: subscription[1] } : null,
        rentedTo: renter !== none ? { address: renter.toLowerCase(), until: new Date(Number(renterUntil) * 1000) } : null,
      };
    } catch (err) {
      this.explain(err, 'read the marketplace');
    }
  }

  /** Sends test POL from ALT's relayer. Only on the local development chain, where it has no value. */
  async giveTestFunds(to: string, value: bigint) {
    if (!this.isLocalDevChain) throw new AppError(409, 'NOT_A_TEST_CHAIN', 'Test funds are only available on the local development chain.');
    try {
      const hash = await this.walletClient.sendTransaction({ to: getAddress(to), value });
      await this.publicClient.waitForTransactionReceipt({ hash, confirmations: this.confirmations, timeout: 180_000 });
      return hash;
    } catch (err) {
      this.explain(err, 'send test funds');
    }
  }

  /**
   * Acts as a person's ALT-managed (custodial) wallet. Contract calls are "sponsored": if the wallet
   * can't pay the network fee, ALT's relayer tops it up with just enough first, so people don't need
   * POL to list an AI or collect their earnings.
   */
  custodial(privateKey: Hex) {
    const account = privateKeyToAccount(privateKey);
    const wallet = createWalletClient({ chain: this.walletClient.chain, account, transport: http(this.rpcUrl) });
    const pub = this.publicClient;
    const relayer = this.walletClient;
    const confirmations = this.confirmations;
    const explain = (err: unknown, action: string): never => this.explain(err, action);
    const requireMarket = () => this.requireMarket();
    const registry = this.registryAddress;

    /** Tops the wallet up so it can pay `value` (its own money) plus the network fee (ALT's). */
    const sponsor = async (gas: bigint, value = 0n) => {
      const fees = await pub.estimateFeesPerGas();
      const need = (gas * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n) * 13n) / 10n + value;
      const have = await pub.getBalance({ address: account.address });
      if (have < value) throw new AppError(400, 'INSUFFICIENT_FUNDS', 'Your ALT wallet does not have enough POL for this.');
      if (have >= need) return null;
      const hash = await relayer.sendTransaction({ to: account.address, value: need - have });
      await pub.waitForTransactionReceipt({ hash, confirmations, timeout: 180_000 });
      return { hash, value: need - have };
    };

    /** `value`: POL paid along with the call (buying or renting). */
    const call = async (target: 'registry' | 'market', functionName: string, args: readonly unknown[], action: string, value?: bigint) => {
      const address = target === 'registry' ? registry : requireMarket();
      const abi = (target === 'registry' ? aitRegistryAbi : altMarketplaceAbi) as typeof altMarketplaceAbi;
      try {
        // Simulate first so a refusal (not the owner, not listed...) costs nothing and reads clearly.
        const { request } = await pub.simulateContract({ address, abi, functionName: functionName as never, args: args as never, account, value } as never);
        const gas = await pub.estimateContractGas({ address, abi, functionName: functionName as never, args: args as never, account, value } as never);
        const sponsored = await sponsor(gas, value ?? 0n);
        const hash = await wallet.writeContract(request as never);
        const receipt = await pub.waitForTransactionReceipt({ hash, confirmations, timeout: 180_000 });
        if (receipt.status !== 'success') throw new AppError(502, 'CHAIN_TX_FAILED', `The blockchain could not ${action}.`);
        return { hash, sponsored };
      } catch (err) {
        if (err instanceof AppError) throw err;
        return explain(err, action);
      }
    };

    return {
      address: account.address.toLowerCase(),
      call,
      /** Lets the marketplace move this wallet's tokens when one is sold (needed once per wallet). */
      async ensureMarketApproval() {
        const market = requireMarket();
        const approved = await pub.readContract({ address: registry, abi: aitRegistryAbi, functionName: 'isApprovedForAll', args: [account.address, market] });
        return approved ? null : call('registry', 'setApprovalForAll', [market, true], 'let the marketplace sell this AI');
      },
      /** Sends POL out of the wallet. The person pays this network fee from their own balance. */
      async send(to: string, value: bigint) {
        try {
          const hash = await wallet.sendTransaction({ to: getAddress(to), value });
          const receipt = await pub.waitForTransactionReceipt({ hash, confirmations, timeout: 180_000 });
          if (receipt.status !== 'success') throw new AppError(502, 'CHAIN_TX_FAILED', 'The transfer failed on-chain.');
          return hash;
        } catch (err) {
          if (err instanceof AppError) throw err;
          return explain(err, 'send the POL');
        }
      },
    };
  }

  async blockNumber() {
    return this.publicClient.getBlockNumber({ cacheTime: 0 });
  }

  /** Who holds a token and who is renting it right now (ERC-4907; no renter once the rental ends). */
  async holders(tokenId: bigint) {
    try {
      const [owner, user, expires] = await Promise.all([
        this.publicClient.readContract({ address: this.registryAddress, abi: aitRegistryAbi, functionName: 'ownerOf', args: [tokenId] }),
        this.publicClient.readContract({ address: this.registryAddress, abi: aitRegistryAbi, functionName: 'userOf', args: [tokenId] }),
        this.publicClient.readContract({ address: this.registryAddress, abi: aitRegistryAbi, functionName: 'userExpires', args: [tokenId] }),
      ]);
      const none = /^0x0{40}$/i.test(user);
      return { owner: owner.toLowerCase(), user: none ? null : user.toLowerCase(), userExpires: none ? null : new Date(Number(expires) * 1000) };
    } catch (err) {
      this.explain(err, 'read who holds the AI identity token');
    }
  }

  /**
   * What changed between two blocks, for Core's indexer: tokens whose holder or renter changed
   * (Transfer, UpdateUser; new mints are left out, the mint job records those) and new or renewed
   * subscriptions (Subscribed).
   */
  async registryChanges(fromBlock: bigint, toBlock: bigint) {
    const addresses = this.marketplaceAddress ? [this.registryAddress, this.marketplaceAddress] : [this.registryAddress];
    const logs = await this.publicClient.getLogs({ address: addresses, fromBlock, toBlock });
    const registryLogs = logs.filter((l) => l.address.toLowerCase() === this.registryAddress.toLowerCase());
    const marketLogs = logs.filter((l) => l.address.toLowerCase() !== this.registryAddress.toLowerCase());
    const tokens = new Map<bigint, string>();
    for (const e of parseEventLogs({ abi: aitRegistryAbi, logs: registryLogs, eventName: ['Transfer', 'UpdateUser'] })) {
      if (e.eventName === 'Transfer' && /^0x0{40}$/i.test(e.args.from)) continue;
      tokens.set(e.args.tokenId, e.transactionHash);
    }
    const subscriptions = parseEventLogs({ abi: altMarketplaceAbi, logs: marketLogs, eventName: 'Subscribed' }).map((e) => ({
      tokenId: e.args.tokenId,
      subscriber: e.args.subscriber.toLowerCase(),
      txHash: e.transactionHash,
    }));
    return { holders: [...tokens].map(([tokenId, txHash]) => ({ tokenId, txHash })), subscriptions };
  }

  /** Until when `subscriber` may use the AI (null: not subscribed now). */
  async subscriptionOf(tokenId: bigint, subscriber: string) {
    const expires = await this.publicClient.readContract({
      address: this.requireMarket(),
      abi: altMarketplaceAbi,
      functionName: 'subscriptionExpires',
      args: [tokenId, getAddress(subscriber)],
    });
    return expires > 0n ? new Date(Number(expires) * 1000) : null;
  }

  /** True when no identity token has ever been minted on this registry (token ids start at 1). */
  async isEmpty(): Promise<boolean> {
    try {
      await this.publicClient.readContract({ address: this.registryAddress, abi: aitRegistryAbi, functionName: 'ownerOf', args: [1n] });
      return false;
    } catch (err) {
      if (err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError)) return true;
      throw err;
    }
  }

  async tokenOfAi(aiUuid: string): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: aitRegistryAbi,
      functionName: 'tokenOfAi',
      args: [aiIdToBytes32(aiUuid)],
    });
  }

  async health() {
    try {
      const block = await this.publicClient.getBlockNumber();
      return { ok: true, chainId: this.chainId, network: this.name, block: block.toString() };
    } catch (err) {
      return { ok: false, chainId: this.chainId, network: this.name, error: (err as Error).message.slice(0, 120) };
    }
  }
}
