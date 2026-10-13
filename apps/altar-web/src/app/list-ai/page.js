"use client";
import Link from "next/link";
import NextStep from "../../components/NextStep";
import { useAuth } from "../../contexts/AuthContext";

export default function ListAI() {
  const { user } = useAuth();
  return (
    <NextStep title="List your" accent="AI">
      <p>
        On ALTAR you list an AI you already own, not a file. Create and train it in <b className="text-white">ALTER</b>, deploy it there to mint its
        <b className="text-white"> AI Identity Token</b>, and it appears in <Link href="/profile" className="text-green-400 underline">My AIs</Link>.
      </p>
      <p>Setting a sale price, a daily rent and a monthly subscription for a verified AI opens here in the next ALTAR step.</p>
      {!user && (
        <Link href="/signin?next=/list-ai" className="inline-block mt-2 bg-white text-black px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-green-400">
          Sign in
        </Link>
      )}
    </NextStep>
  );
}
