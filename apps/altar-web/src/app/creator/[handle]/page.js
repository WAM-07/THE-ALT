"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AICard from "../../../components/AICard";
import AitArt from "../../../components/AitArt";
import { Avatar, Button, Chip, Empty, SectionHead, Spinner } from "../../../components/ui";
import { Reveal } from "../../../components/motion";
import { useAI } from "../../../contexts/AIContext";
import { useAuth } from "../../../contexts/AuthContext";
import { mediaUrl, publicApi } from "../../../lib/alt";
import { shortAddress } from "../../../lib/format";

// A person's page on ALTAR: who they are (their public ALT profile) and their verified AIs, the ones
// they made and any others they now own.
export default function CreatorPage() {
  const { handle } = useParams();
  const { user } = useAuth();
  const { aiModels } = useAI();
  const [person, setPerson] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    publicApi(`/core/users/${encodeURIComponent(handle)}`)
      .then((p) => live && setPerson(p))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [handle]);

  const { created, owned, picture } = useMemo(() => {
    const models = aiModels ?? [];
    const id = person?.id;
    const made = models.filter((m) => m.creator?.id === id);
    const holds = models.filter((m) => m.owner?.id === id && m.creator?.id !== id);
    // The picture this person chose for ALTAR, as the AI listings carry it.
    const seen = models.map((m) => (m.creator?.id === id ? m.creator : m.owner?.id === id ? m.owner : null)).find(Boolean);
    return { created: made, owned: holds, picture: mediaUrl(seen?.avatarUrl ?? person?.avatarUrl) };
  }, [aiModels, person]);

  if (missing) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <p className="font-display text-2xl font-bold">No one here</p>
        <p className="mt-2 text-ink-2">There&apos;s no ALT account called @{handle}.</p>
        <Button href="/#explore" kind="outline" className="mt-6">
          Back to the marketplace
        </Button>
      </div>
    );
  }
  if (!person || !aiModels) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const isMe = user?.id === person.id;
  const joined = new Date(person.joinedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="pb-24">
      <div className="relative h-40 overflow-hidden sm:h-56">
        <AitArt seed={`person:${person.id}`} motion="always" className="h-full w-full" />
      </div>
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Avatar src={picture} name={person.displayName} size={112} className="relative -mt-14 ring-[6px] ring-canvas" />
            <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight">{person.displayName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-ink-3">
              <span>@{person.handle}</span>
              <span>· On ALT since {joined}</span>
              {person.walletAddress && <span className="rounded-full bg-sunken px-3 py-1 font-mono text-xs text-ink-2">{shortAddress(person.walletAddress)}</span>}
            </div>
            {person.bio && <p className="mt-3 max-w-2xl text-ink-2">{person.bio}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {person.roles.includes("creator") && <Chip tone="accent">Creator</Chip>}
              <Chip>
                {created.length} verified {created.length === 1 ? "AI" : "AIs"} made
              </Chip>
              {owned.length > 0 && <Chip>{owned.length} more owned</Chip>}
            </div>
          </div>
          {isMe && (
            <Button href="/profile" kind="outline" size="sm">
              This is you · Your profile
            </Button>
          )}
        </div>

        <section className="pt-12">
          <SectionHead eyebrow="Made by them" title={`${person.displayName.split(" ")[0]}'s AIs`} />
          {created.length === 0 ? (
            <Empty title="No verified AIs yet">AIs appear here once they&apos;re built in ALTER and verified with an identity token.</Empty>
          ) : (
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
              {created.map((m, i) => (
                <Reveal key={m.id} delay={(i % 4) * 70}>
                  <AICard model={m} />
                </Reveal>
              ))}
            </div>
          )}
        </section>

        {owned.length > 0 && (
          <section className="pt-12">
            <SectionHead eyebrow="Bought on ALTAR" title="Also owns" />
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
              {owned.map((m, i) => (
                <Reveal key={m.id} delay={(i % 4) * 70}>
                  <AICard model={m} />
                </Reveal>
              ))}
            </div>
          </section>
        )}

        <p className="mt-12 text-sm text-ink-3">
          <Link href="/#explore" className="hover:text-ink">
            ← Explore every AI
          </Link>
        </p>
      </div>
    </div>
  );
}
