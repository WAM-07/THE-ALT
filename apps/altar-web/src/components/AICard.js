"use client";
import Link from "next/link";
import AitArt from "./AitArt";
import { Avatar, Chip, VerifiedTick } from "./ui";
import { useAuth } from "../contexts/AuthContext";
import { useWishlist } from "../contexts/WishlistContext";
import { useTilt } from "./motion";

// One verified AI in a grid: its token's artwork with the AI's own picture on top, like a
// collectible. Prices appear when listings open (ALTAR step 2); until then it says so.
export default function AICard({ model }) {
  const { user } = useAuth();
  const { wishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const mine = Boolean(user && model.owner?.id === user.id);
  const saved = wishlist?.some((w) => w.agentId === model.id);
  const tilt = useTilt(6);

  return (
    <div {...tilt} className="tilt group relative rounded-3xl border border-line bg-surface p-2 hover:shadow-card">
      <Link href={`/details/${model.handle}`} className="block rounded-[20px] outline-offset-4">
        <div className="relative aspect-square overflow-hidden rounded-[20px]">
          <AitArt seed={model.artSeed} className="h-full w-full transition duration-700 group-hover:scale-[1.06]" />
          {model.token && <Chip tone="glass" className="absolute left-3 top-3">AIT #{model.token.tokenId}</Chip>}
          <Avatar src={model.image} name={model.name} size={48} className="absolute bottom-3 left-3 ring-[3px] ring-white/80" />
          {mine && <Chip tone="glass" className="absolute bottom-4 right-3">Yours</Chip>}
          <span className="tilt-shine absolute inset-0" />
        </div>
        <div className="px-2 pb-2 pt-3">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-display text-[17px] font-bold leading-tight">{model.name}</h3>
            {model.verified && <VerifiedTick />}
          </div>
          <p className="mt-0.5 truncate text-sm text-ink-2">
            by {model.creatorName} · {model.category}
          </p>
          <div className="mt-3 flex items-end justify-between rounded-2xl bg-sunken px-3 py-2">
            <div>
              <p className="text-[11px] font-medium text-ink-3">Price</p>
              <p className="text-sm font-semibold text-ink-2">Not listed yet</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-medium text-ink-3">Health</p>
              <p className="text-sm font-semibold">{Math.round(model.healthScore ?? 0)}%</p>
            </div>
          </div>
        </div>
      </Link>
      {!mine && (
        <button
          onClick={() => (saved ? removeFromWishlist(model.id) : addToWishlist(model))}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${model.name} from your wishlist` : `Save ${model.name} to your wishlist`}
          className={`absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md transition ${saved ? "bg-white text-rose-500" : "bg-black/40 text-white hover:bg-black/60"}`}
        >
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
          </svg>
        </button>
      )}
    </div>
  );
}
