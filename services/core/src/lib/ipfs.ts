import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';
import { canonical } from './audit.js';
import { AppError } from './errors.js';

export interface PinnedDocument {
  cid: string;
  /** sha256 of the exact bytes pinned, recorded in the database so the content can be re-verified. */
  sha256: string;
  size: number;
}

/**
 * Module 6: public, content-addressed storage for AI manifests and token metadata.
 * Only hashes and public descriptions go here, never personal data.
 */
export interface IpfsStore {
  readonly mode: 'local' | 'pinata';
  /** Pins a JSON document. The bytes are canonical JSON, so the same document always gets the same CID. */
  pinJson(name: string, document: unknown): Promise<PinnedDocument>;
  /** Fetches the exact bytes stored under a CID. */
  getBytes(cid: string): Promise<Buffer>;
  /** A public URL people can open. */
  gatewayUrl(cid: string): string;
}

export const canonicalBytes = (document: unknown) => Buffer.from(canonical(document), 'utf8');
export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Development: a real CIDv1 (raw codec, sha2-256) computed locally; bytes kept under STORAGE_DIR/ipfs. */
export function localIpfs(storageDir: string, publicUrl: string): IpfsStore {
  const dir = path.resolve(storageDir, 'ipfs');
  return {
    mode: 'local',
    async pinJson(_name, document) {
      const bytes = canonicalBytes(document);
      const cid = CID.create(1, raw.code, await sha256.digest(bytes)).toString();
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, cid), bytes);
      return { cid, sha256: sha256Hex(bytes), size: bytes.length };
    },
    async getBytes(cid) {
      let parsed: CID;
      try {
        parsed = CID.parse(cid);
      } catch {
        throw new AppError(400, 'INVALID_CID', 'That is not a valid IPFS content id.');
      }
      try {
        const bytes = await readFile(path.join(dir, parsed.toString()));
        // Content addressing: refuse anything whose hash no longer matches its CID.
        const check = CID.create(1, raw.code, await sha256.digest(bytes));
        if (!check.equals(parsed)) throw new AppError(409, 'IPFS_CONTENT_CORRUPT', 'Stored content does not match its CID.');
        return bytes;
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(404, 'NOT_FOUND', 'No content with that CID.');
      }
    },
    gatewayUrl: (cid) => `${publicUrl}/core/ipfs/${cid}`,
  };
}

/** Demo and production: pinned with Pinata, so anyone can fetch it from any IPFS gateway. */
export function pinataIpfs(jwt: string, gateway: string): IpfsStore {
  const base = gateway.replace(/\/$/, '');
  return {
    mode: 'pinata',
    async pinJson(name, document) {
      const bytes = canonicalBytes(document);
      // pinFileToIPFS stores our exact bytes (pinJSONToIPFS would re-serialise them).
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'application/json' }), `${name}.json`);
      form.append('pinataMetadata', JSON.stringify({ name }));
      form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
      const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new AppError(502, 'IPFS_PIN_FAILED', `IPFS pinning failed (HTTP ${res.status}).`);
      const body = (await res.json()) as { IpfsHash: string; PinSize: number };
      return { cid: body.IpfsHash, sha256: sha256Hex(bytes), size: body.PinSize ?? bytes.length };
    },
    async getBytes(cid) {
      const res = await fetch(`${base}/ipfs/${encodeURIComponent(cid)}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new AppError(502, 'IPFS_FETCH_FAILED', `Could not fetch ${cid} from IPFS (HTTP ${res.status}).`);
      return Buffer.from(await res.arrayBuffer());
    },
    gatewayUrl: (cid) => `${base}/ipfs/${cid}`,
  };
}
