"use client";
import { useState } from "react";
import NextStep from "../../components/NextStep";
import { Button, Card, Chip } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { continueWithAlt } from "../../lib/alt";

export default function Wallet() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const address = user?.wallet?.address;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the address is on screen.
    }
  };

  return (
    <NextStep eyebrow="Wallet" title="Your ALT wallet" intro="Every ALT account has its own wallet. It holds your AI Identity Tokens, and ALTAR payments will be made from it, on-chain.">
      {user ? (
        <>
          <Card className="p-6">
            <p className="text-sm font-medium text-ink-3">Address</p>
            <p className="mt-1 break-all font-mono text-[15px]">{address ?? "—"}</p>
            {address && (
              <Button kind="outline" size="sm" className="mt-4" onClick={copy}>
                {copied ? "Copied" : "Copy address"}
              </Button>
            )}
          </Card>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-6">
            <div>
              <p className="font-display text-lg font-bold">Balance, earnings and withdrawals</p>
              <p className="mt-1 text-ink-2">Arrive with buying and renting, including test funds on the local chain.</p>
            </div>
            <Chip tone="soon">Opens soon</Chip>
          </Card>
        </>
      ) : (
        <Button onClick={() => continueWithAlt("signin", "/wallet").catch(() => {})}>Continue with ALT</Button>
      )}
    </NextStep>
  );
}
