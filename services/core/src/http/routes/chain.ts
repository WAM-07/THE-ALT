import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { AppError } from '../../lib/errors.js';
import { sha256Hex } from '../../lib/ipfs.js';

export const requireChain = (ctx: Ctx) => {
  if (!ctx.chain) throw new AppError(503, 'CHAIN_DISABLED', 'The blockchain is not configured on this server.');
  return ctx.chain;
};

/** Public blockchain information, IPFS content and token verification (Modules 6 and 17). */
export async function chainRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/chain', { schema: { tags: ['blockchain'], summary: 'Which network and contracts ALT uses' } }, async () => {
    if (!ctx.chain) return { enabled: false };
    return {
      enabled: true,
      network: ctx.chain.name,
      chainId: ctx.chain.chainId,
      contracts: { aitRegistry: ctx.chain.registryAddress, marketplace: ctx.chain.marketplaceAddress },
      relayer: ctx.chain.relayerAddress,
      ipfs: ctx.ipfs.mode,
      status: await ctx.chain.health(),
    };
  });

  r.get(
    '/ipfs/:cid',
    { schema: { tags: ['blockchain'], summary: 'Content stored on IPFS (AI manifests)', params: z.object({ cid: z.string().min(10).max(120) }) } },
    async (req, reply) => {
      if (ctx.ipfs.mode !== 'local') return reply.redirect(ctx.ipfs.gatewayUrl(req.params.cid));
      const bytes = await ctx.ipfs.getBytes(req.params.cid);
      reply.header('cache-control', 'public, max-age=31536000, immutable').type('application/json');
      return reply.send(bytes);
    },
  );

  r.get(
    '/verify/token/:tokenId',
    {
      schema: {
        tags: ['blockchain'],
        summary: 'Independently check an AI identity token: on-chain record and its IPFS manifest',
        params: z.object({ tokenId: z.coerce.bigint().positive() }),
      },
    },
    async (req) => {
      const chain = requireChain(ctx);
      const identity = await chain.readIdentity(req.params.tokenId);
      let manifest: unknown = null;
      let manifestSha256: string | null = null;
      let manifestReadable = false;
      try {
        const bytes = await ctx.ipfs.getBytes(identity.manifestCid);
        manifestSha256 = sha256Hex(bytes);
        manifest = JSON.parse(bytes.toString('utf8'));
        manifestReadable = true;
      } catch {
        // Reported below; the on-chain record is still shown.
      }
      return {
        tokenId: identity.tokenId.toString(),
        network: chain.name,
        chainId: chain.chainId,
        contract: chain.registryAddress,
        owner: identity.owner,
        creator: identity.creator,
        version: Number(identity.version),
        suspended: identity.suspended,
        manifestCid: identity.manifestCid,
        tokenUri: identity.tokenUri,
        manifestUrl: ctx.ipfs.gatewayUrl(identity.manifestCid),
        manifestReadable,
        manifestSha256,
        manifest,
        explorer: chain.explorerToken(identity.tokenId),
      };
    },
  );
}
