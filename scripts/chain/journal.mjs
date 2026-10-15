// Keeps the demo's local blockchain across restarts. Hardhat's chain lives in memory, so while the
// demo runs every new block is written to .data/demo-chain.jsonl (its time and its signed
// transactions, failed ones included). The next `npm run demo` starts a new chain on the original
// date and replays those blocks one by one: the same contracts, balances, tokens, listings,
// rentals and subscriptions, at the same block numbers and with the same transaction hashes.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { keccak256, serializeTransaction } from 'viem';

const hex = (n) => `0x${n.toString(16)}`;

export async function rpc(url, method, params = [], { allowError = false } = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error && !allowError) throw new Error(`${method}: ${body.error.message}`);
  return body.error ? { error: body.error } : body.result;
}

/** The signed transaction exactly as it was sent, rebuilt from the block (checked against its hash). */
function rawOf(tx) {
  const base = { nonce: Number(tx.nonce), gas: BigInt(tx.gas), to: tx.to ?? null, value: BigInt(tx.value), data: tx.input };
  let unsigned;
  let signature;
  if (tx.type === '0x2') {
    unsigned = { ...base, type: 'eip1559', chainId: Number(tx.chainId), maxFeePerGas: BigInt(tx.maxFeePerGas), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas), accessList: tx.accessList ?? [] };
    signature = { r: tx.r, s: tx.s, yParity: Number(tx.yParity ?? tx.v) };
  } else if (tx.type === '0x1') {
    unsigned = { ...base, type: 'eip2930', chainId: Number(tx.chainId), gasPrice: BigInt(tx.gasPrice), accessList: tx.accessList ?? [] };
    signature = { r: tx.r, s: tx.s, yParity: Number(tx.yParity ?? tx.v) };
  } else {
    unsigned = { ...base, type: 'legacy', gasPrice: BigInt(tx.gasPrice), ...(tx.chainId ? { chainId: Number(tx.chainId) } : {}) };
    signature = { r: tx.r, s: tx.s, v: BigInt(tx.v) };
  }
  const raw = serializeTransaction(unsigned, signature);
  if (keccak256(raw) !== tx.hash) throw new Error(`could not rebuild transaction ${tx.hash} (type ${tx.type})`);
  return raw;
}

/** { meta, blocks } from a saved demo, or null when there is none. */
export function readJournal(metaFile, blocksFile) {
  if (!existsSync(metaFile) || !existsSync(blocksFile)) return null;
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const blocks = readFileSync(blocksFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { meta, blocks };
}

/** Replays saved blocks onto a new chain that started on the saved genesis date. */
export async function replayJournal(url, blocks, log = () => {}) {
  let done = 0;
  for (const b of blocks) {
    const head = Number(await rpc(url, 'eth_blockNumber'));
    if (head !== b.n - 1) throw new Error(`the saved chain is out of step at block ${b.n} (the new chain is at ${head})`);
    if (b.txs.length === 0) {
      await rpc(url, 'evm_mine', [b.ts]);
    } else if (b.txs.length === 1) {
      await rpc(url, 'evm_setNextBlockTimestamp', [b.ts]);
      // A transaction that failed the first time fails again, and is still mined the same way.
      await rpc(url, 'eth_sendRawTransaction', [b.txs[0]], { allowError: true });
    } else {
      await rpc(url, 'evm_setAutomine', [false]);
      for (const raw of b.txs) await rpc(url, 'eth_sendRawTransaction', [raw], { allowError: true });
      await rpc(url, 'evm_mine', [b.ts]);
      await rpc(url, 'evm_setAutomine', [true]);
    }
    if (Number(await rpc(url, 'eth_blockNumber')) !== b.n) throw new Error(`block ${b.n} could not be replayed`);
    if (++done % 100 === 0) log(`  …${done} of ${blocks.length} blocks`);
  }
}

/** Starts a new saved demo: its metadata (genesis date, deployment, contract sources) and no blocks yet. */
export function startJournal(metaFile, blocksFile, meta) {
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  writeFileSync(blocksFile, '');
}

export function updateMeta(metaFile, patch) {
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  writeFileSync(metaFile, JSON.stringify({ ...meta, ...patch }, null, 2));
}

/** Writes every new block from `from` on as it is mined. `flush()` writes the last ones before shutdown. */
export function recordBlocks(url, blocksFile, from, log = () => {}) {
  let next = from;
  let running = Promise.resolve();
  const poll = async () => {
    const head = Number(await rpc(url, 'eth_blockNumber'));
    while (next <= head) {
      const b = await rpc(url, 'eth_getBlockByNumber', [hex(next), true]);
      appendFileSync(blocksFile, `${JSON.stringify({ n: next, ts: Number(b.timestamp), txs: b.transactions.map(rawOf) })}\n`);
      next++;
    }
  };
  const timer = setInterval(() => {
    running = running.then(poll).catch((err) => log(`chain journal: ${err.message}`));
  }, 400);
  return {
    async flush() {
      clearInterval(timer);
      await running;
      await poll().catch((err) => log(`chain journal: ${err.message}`));
    },
  };
}
