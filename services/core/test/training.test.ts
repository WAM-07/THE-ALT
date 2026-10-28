import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { respond } from '../src/modules/ai/engine.js';
import { loadAi } from '../src/modules/ai/repo.js';
import { auth, makeApp, signUp, trainAi, uniq, type TestApp } from './helpers.js';

// Training (Module 9, "the engine and the car"): the simulated stand-in, the trainer socket and the
// inference socket for trained adapters.

const SERVICE = { 'x-alt-service-key': 'test-internal-service-key-0123456789abcdef', 'x-alt-service': 'alt-trainer-1' };
const OTHER_TRAINER = { ...SERVICE, 'x-alt-service': 'alt-trainer-2' };

let sim: TestApp;
let real: TestApp;
let adapterServer: Server;
const adapterCalls: Record<string, unknown>[] = [];

beforeAll(async () => {
  // A stand-in for ALT's adapter inference server.
  adapterServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      adapterCalls.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ text: 'Answered by the trained adapter.', tokensIn: 10, tokensOut: 5 }));
    });
  });
  await new Promise<void>((r) => adapterServer.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(adapterServer.address() as AddressInfo).port}`;
  sim = await makeApp();
  real = await makeApp({ TRAINING_MODE: 'trainer', ADAPTER_INFERENCE_URL: url });
});
afterAll(async () => {
  await Promise.all([sim.app.close(), real.app.close(), new Promise((r) => adapterServer.close(r))]);
});

async function newAi(t: TestApp, token: string, consents: Record<string, boolean> = { persona_training: true }) {
  const ai = (await t.app.inject({ method: 'POST', url: '/ais', headers: auth(token), payload: { name: 'Tutor', handle: `t_${uniq()}`, consents } })).json();
  await t.app.inject({ method: 'POST', url: `/ais/${ai.id}/datasets`, headers: auth(token), payload: { title: 'Lecture notes', text: 'Graphs: BFS visits level by level.' } });
  return ai as { id: string };
}

describe('simulated training (TRAINING_MODE=simulated, the labelled stand-in)', () => {
  it('runs labelled checkpoints and produces a trained version that says it was simulated', async () => {
    const u = await signUp(sim);
    const ai = await newAi(sim, u.accessToken);
    const start = await sim.app.inject({ method: 'POST', url: `/ais/${ai.id}/trainings`, headers: auth(u.accessToken) });
    expect(start.statusCode).toBe(202);
    expect(start.json()).toMatchObject({ status: 'queued', mode: 'simulated', simulated: true });
    // One training at a time.
    expect((await sim.app.inject({ method: 'POST', url: `/ais/${ai.id}/trainings`, headers: auth(u.accessToken) })).json().error.code).toBe('TRAINING_IN_PROGRESS');

    await sim.app.jobs.drain();
    const [done] = (await sim.app.inject({ method: 'GET', url: `/ais/${ai.id}/trainings`, headers: auth(u.accessToken) })).json();
    expect(done).toMatchObject({ status: 'completed', progress: 100, simulated: true });
    expect(done.checkpoints.map((c: { stage: string }) => c.stage)).toEqual([
      'preparing your data',
      'training (simulated)',
      'evaluating (simulated)',
      'saving the adapter (simulated)',
    ]);
    const [version] = (await sim.app.inject({ method: 'GET', url: `/ais/${ai.id}/versions`, headers: auth(u.accessToken) })).json();
    expect(version).toMatchObject({ id: done.versionId, engine: 'adapter', training: 'simulated', simulated: true });
    const inbox = (await sim.app.inject({ method: 'GET', url: '/notifications', headers: auth(u.accessToken) })).json();
    expect(JSON.stringify(inbox)).toContain('finished simulated training');
    const { rows } = await sim.app.ctx.db.query(`SELECT action FROM core.audit_log WHERE entity_id = $1 ORDER BY id`, [ai.id]);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['ai.training_started', 'ai.training_completed']));
  });

  it('needs consent to train on the owner’s data, and only the owner can start it', async () => {
    const [owner, other] = [await signUp(sim), await signUp(sim)];
    const ai = await newAi(sim, owner.accessToken, { persona_training: false });
    expect((await sim.app.inject({ method: 'POST', url: `/ais/${ai.id}/trainings`, headers: auth(owner.accessToken) })).json().error.code).toBe('CONSENT_REQUIRED');
    expect((await sim.app.inject({ method: 'POST', url: `/ais/${ai.id}/trainings`, headers: auth(other.accessToken) })).statusCode).toBe(404);
  });

  it('a trained version can never be edited into something else', async () => {
    const u = await signUp(sim);
    const ai = await newAi(sim, u.accessToken);
    const training = await trainAi(sim, ai.id, u.accessToken);
    await expect(sim.app.ctx.db.query(`UPDATE core.ai_versions SET engine = 'base' WHERE id = $1`, [training.versionId])).rejects.toThrow(/immutable/);
  });
});

describe('the trainer socket (TRAINING_MODE=trainer)', () => {
  it('a trainer claims the job, gets the consented data, reports checkpoints and returns the adapter', async () => {
    const u = await signUp(real);
    const ai = await newAi(real, u.accessToken);
    const start = (await real.app.inject({ method: 'POST', url: `/ais/${ai.id}/trainings`, headers: auth(u.accessToken) })).json();
    expect(start).toMatchObject({ status: 'queued', mode: 'cloud', simulated: false, stage: 'waiting for a trainer' });
    await real.app.jobs.drain(); // nothing simulated runs
    expect((await real.app.ctx.db.query('SELECT status FROM core.training_jobs WHERE id = $1', [start.id])).rows[0].status).toBe('queued');

    // Only ALT services.
    expect((await real.app.inject({ method: 'POST', url: '/internal/trainer/claim' })).statusCode).toBe(401);
    // Claim until we get this test's job (others may be waiting).
    let claimed: { id: string; dataUrl: string } | null = null;
    for (let i = 0; i < 20 && claimed?.id !== start.id; i++) {
      const res = await real.app.inject({ method: 'POST', url: '/internal/trainer/claim', headers: SERVICE });
      if (res.statusCode === 204) break;
      claimed = res.json();
    }
    expect(claimed?.id).toBe(start.id);

    // Another trainer can't touch it.
    expect((await real.app.inject({ method: 'GET', url: claimed!.dataUrl, headers: OTHER_TRAINER })).json().error.code).toBe('NOT_YOUR_TRAINING');
    const data = (await real.app.inject({ method: 'GET', url: claimed!.dataUrl, headers: SERVICE })).json();
    expect(data).toMatchObject({ aiId: ai.id, documents: [{ title: 'Lecture notes', text: 'Graphs: BFS visits level by level.' }] });

    const cp = await real.app.inject({ method: 'POST', url: `/internal/trainer/jobs/${start.id}/checkpoints`, headers: SERVICE, payload: { stage: 'epoch 1', progress: 40, step: 120, loss: 1.82 } });
    expect(cp.statusCode).toBe(200);
    const progress = (await real.app.inject({ method: 'GET', url: `/ais/${ai.id}/trainings`, headers: auth(u.accessToken) })).json()[0];
    expect(progress).toMatchObject({ status: 'running', stage: 'epoch 1', progress: 40, checkpoints: [{ stage: 'epoch 1', loss: 1.82 }] });

    // The trainer must state it deleted the data.
    const adapter = { adapterSha256: 'a'.repeat(64), adapterUri: 's3://alt-adapters/tutor-1.safetensors', scores: { readiness: 87.5, loss: 0.9 } };
    expect((await real.app.inject({ method: 'POST', url: `/internal/trainer/jobs/${start.id}/complete`, headers: SERVICE, payload: adapter })).statusCode).toBe(400);
    const done = await real.app.inject({ method: 'POST', url: `/internal/trainer/jobs/${start.id}/complete`, headers: SERVICE, payload: { ...adapter, dataDeleted: true } });
    expect(done.statusCode).toBe(200);

    const [version] = (await real.app.inject({ method: 'GET', url: `/ais/${ai.id}/versions`, headers: auth(u.accessToken) })).json();
    expect(version).toMatchObject({ id: done.json().versionId, engine: 'adapter', training: 'cloud', simulated: false, readiness: 87.5 });
    const manifest = (await real.app.inject({ method: 'GET', url: `/ipfs/${version.manifestCid}` })).json();
    expect(manifest.engine).toEqual({ type: 'adapter', training: 'cloud', adapterSha256: 'a'.repeat(64) });
    expect(JSON.stringify(manifest)).not.toContain('BFS visits'); // hashes only
    const job = (await real.app.ctx.db.query('SELECT status, data_deleted_at FROM core.training_jobs WHERE id = $1', [start.id])).rows[0];
    expect(job.status).toBe('completed');
    expect(job.data_deleted_at).toBeInstanceOf(Date);
    // A finished job is no longer the trainer's to change.
    expect((await real.app.inject({ method: 'GET', url: claimed!.dataUrl, headers: SERVICE })).statusCode).toBe(403);

    // The inference socket: once verified, the trained version answers through its adapter.
    await real.app.ctx.db.query(`UPDATE core.personal_ais SET status = 'verified', current_version_id = $2 WHERE id = $1`, [ai.id, version.id]);
    const live = (await loadAi(real.app.ctx.db, ai.id))!;
    const reply = await respond(real.app.ctx, { ai: live, version: 'current', channel: 'alter_chat', messages: [{ role: 'user', content: 'What is BFS?' }] });
    expect(reply).toMatchObject({ text: 'Answered by the trained adapter.', provider: 'alt-adapter' });
    expect(adapterCalls.at(-1)).toMatchObject({ adapterUri: adapter.adapterUri, adapterSha256: adapter.adapterSha256 });
  });

  it('a silent trainer loses its claim; withdrawn consent stops the training', async () => {
    const u = await signUp(real);
    const ai = await newAi(real, u.accessToken);
    const start = (await real.app.inject({ method: 'POST', url: `/ais/${ai.id}/trainings`, headers: auth(u.accessToken) })).json();
    await real.app.ctx.db.query(`UPDATE core.training_jobs SET status = 'running', claimed_by = 'gone', lease_expires_at = now() - interval '1 minute' WHERE id = $1`, [start.id]);
    let claimed: { id: string } | null = null;
    for (let i = 0; i < 20 && claimed?.id !== start.id; i++) {
      const res = await real.app.inject({ method: 'POST', url: '/internal/trainer/claim', headers: SERVICE });
      if (res.statusCode === 204) break;
      claimed = res.json();
    }
    expect(claimed?.id).toBe(start.id);

    await real.app.inject({ method: 'PUT', url: `/ais/${ai.id}/consents/persona_training`, headers: auth(u.accessToken), payload: { granted: false } });
    expect((await real.app.inject({ method: 'GET', url: `/internal/trainer/jobs/${start.id}/data`, headers: SERVICE })).json().error.code).toBe('CONSENT_WITHDRAWN');
    const [failed] = (await real.app.inject({ method: 'GET', url: `/ais/${ai.id}/trainings`, headers: auth(u.accessToken) })).json();
    expect(failed).toMatchObject({ status: 'failed', error: 'The owner withdrew consent to train on their data.' });
  });
});

describe('bringing an adapter trained on the owner’s own GPU (E4)', () => {
  const upload = (t: TestApp, aiId: string, token: string, bytes: Buffer, name = 'adapter.safetensors') => {
    const boundary = `b${uniq()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="baseModel"\r\n\r\nQwen2.5-3B-Instruct\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return t.app.inject({ method: 'POST', url: `/ais/${aiId}/trainings/local`, headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
  };
  // A tiny but well-formed safetensors file: 8-byte header length, JSON header, tensor bytes.
  const header = Buffer.from(JSON.stringify({ __metadata__: { format: 'pt' }, 'lora_A.weight': { dtype: 'F32', shape: [2], data_offsets: [0, 8] } }));
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(header.length));
  const safetensors = Buffer.concat([len, header, Buffer.alloc(8, 1)]);

  it('accepts a real adapter file as a version "trained locally", and refuses anything else', async () => {
    const u = await signUp(sim);
    const ai = await newAi(sim, u.accessToken);
    expect((await upload(sim, ai.id, u.accessToken, Buffer.from('not an adapter at all'), 'notes.txt')).json().error.code).toBe('ADAPTER_FORMAT');

    const res = await upload(sim, ai.id, u.accessToken, safetensors);
    expect(res.statusCode).toBe(201);
    const { createHash } = await import('node:crypto');
    expect(res.json().adapterSha256).toBe(createHash('sha256').update(safetensors).digest('hex'));
    const [version] = (await sim.app.inject({ method: 'GET', url: `/ais/${ai.id}/versions`, headers: auth(u.accessToken) })).json();
    expect(version).toMatchObject({ id: res.json().versionId, engine: 'adapter', training: 'local', simulated: false });
    const clearance = (await sim.app.inject({ method: 'GET', url: `/ais/${ai.id}/clearance`, headers: auth(u.accessToken) })).json();
    expect(clearance.checks.find((c: { id: string }) => c.id === 'trained')).toMatchObject({ passed: true, detail: 'trained locally' });

    // ALT's inference server can fetch it (service key only).
    const file = `${res.json().adapterSha256}.safetensors`;
    expect((await sim.app.inject({ method: 'GET', url: `/internal/trainer/adapters/${file}` })).statusCode).toBe(401);
    const got = await sim.app.inject({ method: 'GET', url: `/internal/trainer/adapters/${file}`, headers: SERVICE });
    expect(Buffer.compare(got.rawPayload, safetensors)).toBe(0);
  });
});
