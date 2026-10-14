"use client";
import { useEffect, useState } from "react";
import { linkedWallets } from "../lib/alt";
import { shortAddress } from "../lib/format";
import { hasBrowserWallet, signWithBrowserWallet } from "../lib/metamask";
import { Button, Card, Chip } from "./ui";

/**
 * Your wallets: the ALT wallet (ALT signs for you) and wallets you linked, such as MetaMask. Linking
 * signs a one-time message in MetaMask; nothing else leaves it. AIs and POL in a linked wallet count
 * as yours in ALT; buying, renting and listing still use the ALT wallet.
 */
export default function LinkedWallets() {
  const [wallets, setWallets] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // After the first paint, so the server-rendered page and the browser agree.
    Promise.resolve().then(() => setInstalled(hasBrowserWallet()));
    linkedWallets
      .list()
      .then(setWallets)
      .catch(() => setWallets([]));
  }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const nonce = await linkedWallets.nonce();
      const { address, message, signature } = await signWithBrowserWallet(nonce);
      setWallets(await linkedWallets.link(message, signature));
      setNotice(`${shortAddress(address)} is linked to your ALT account.`);
    } catch (err) {
      setError(err.code === 4001 ? "You cancelled in MetaMask." : err.message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (address) => {
    setBusy(true);
    setError(null);
    try {
      setWallets(await linkedWallets.unlink(address));
      setNotice(`${shortAddress(address)} was removed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-5 p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Your wallets</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">
            Link MetaMask to show that its AIs and POL are yours in ALT. Linking only signs a message: your keys stay in MetaMask, and buying, renting and listing still use your ALT wallet.
          </p>
        </div>
        {installed ? (
          <Button onClick={connect} disabled={busy}>
            {busy ? "Waiting for MetaMask…" : "Connect MetaMask"}
          </Button>
        ) : (
          <Button href="https://metamask.io/download/" kind="outline" target="_blank" rel="noreferrer">
            Install MetaMask ↗
          </Button>
        )}
      </div>
      {error && <p className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>}
      {notice && <p className="mt-4 rounded-2xl bg-accent/10 px-4 py-3 text-sm font-medium text-ink">{notice}</p>}
      <ul className="mt-5 divide-y divide-line">
        {(wallets ?? []).map((w) => (
          <li key={w.address} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{w.kind === "custodial" ? "ALT wallet" : w.label || "Linked wallet"}</p>
              <p className="font-mono text-xs text-ink-3">{shortAddress(w.address)}</p>
            </div>
            <div className="flex items-center gap-2">
              {w.isPrimary && <Chip tone="accent">Primary</Chip>}
              {w.kind === "custodial" ? (
                <Chip>ALT signs for you</Chip>
              ) : (
                <Button kind="ghost" size="sm" onClick={() => unlink(w.address)} disabled={busy}>
                  Remove
                </Button>
              )}
            </div>
          </li>
        ))}
        {wallets === null && <li className="py-3 text-sm text-ink-3">Loading…</li>}
      </ul>
    </Card>
  );
}
