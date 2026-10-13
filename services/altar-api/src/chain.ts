import { aitRegistryAbi, altMarketplaceAbi } from '@alt/contracts/abi';
import { createPublicClient, getAddress, http, type Address } from 'viem';
import { AltarError } from './errors.js';

/** What the marketplace contract says about one token. */
export interface OnChainOffer {
  owner: string;
  sale: { priceWei: bigint } | null;
  rent: { pricePerDayWei: bigint; maxDays: number } | null;
}

/**
 * ALTAR's read-only view of the chain. The contract is the truth for prices; ALTAR mirrors it so
 * browsing is fast. A listing only counts while its lister still owns the token.
 */
export function createChainReader(cfg: { rpcUrl: string; registry: string; marketplace: string }) {
  const client = createPublicClient({ transport: http(cfg.rpcUrl) });
  const registry = getAddress(cfg.registry) as Address;
  const market = getAddress(cfg.marketplace) as Address;

  return {
    async offer(tokenId: bigint): Promise<OnChainOffer> {
      try {
        const [owner, sale, rent] = await Promise.all([
          client.readContract({ address: registry, abi: aitRegistryAbi, functionName: 'ownerOf', args: [tokenId] }),
          client.readContract({ address: market, abi: altMarketplaceAbi, functionName: 'sales', args: [tokenId] }),
          client.readContract({ address: market, abi: altMarketplaceAbi, functionName: 'rentalOffers', args: [tokenId] }),
        ]);
        const o = owner.toLowerCase();
        return {
          owner: o,
          // A listing left behind by a previous owner is dead: the contract would refuse it.
          sale: sale[1] > 0n && sale[0].toLowerCase() === o ? { priceWei: sale[1] } : null,
          rent: rent[1] > 0n && rent[0].toLowerCase() === o ? { pricePerDayWei: rent[1], maxDays: Number(rent[2]) } : null,
        };
      } catch (err) {
        throw new AltarError(502, 'CHAIN_UNAVAILABLE', 'Could not read the marketplace on the blockchain.', { reason: (err as Error).message.slice(0, 200) });
      }
    },
  };
}

export type ChainReader = ReturnType<typeof createChainReader>;
