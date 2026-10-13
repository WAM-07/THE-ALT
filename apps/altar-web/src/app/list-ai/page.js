"use client";
import NextStep from "../../components/NextStep";
import { Button, Card, Chip } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useModal } from "../../contexts/ModalContext";
import { auth, continueWithAlt } from "../../lib/alt";

const STEPS = [
  ["Create it in ALTER", "Give your AI a personality, add what it should know, and chat with it until it sounds like you.", "In ALTER today"],
  ["Deploy it to mint its AIT", "ALTER checks consent and safety, then mints the AI Identity Token to your ALT wallet. It then appears on ALTAR.", "In ALTER today"],
  ["Set your terms here", "Choose a sale price, a daily rent and a monthly subscription. Royalties come back to you on every resale.", "Opens soon"],
];

export default function ListAI() {
  const { user } = useAuth();
  const { showAlert } = useModal();
  const openAlter = async () => {
    try {
      const { url } = await auth.handoffTo("alter");
      window.location.href = url;
    } catch {
      showAlert("Open ALTER", "Open the ALTER app on your phone to create your AI.");
    }
  };

  return (
    <NextStep eyebrow="Sell on ALTAR" title="List your AI" intro="On ALTAR you sell an AI you own, not a file. Its token carries the rights, so buyers know exactly what they get.">
      {STEPS.map(([title, text, status], i) => (
        <Card key={title} className="flex gap-5 p-6">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-lg font-bold ${i < 2 ? "bg-accent text-accent-ink" : "bg-sunken text-ink-3"}`}>{i + 1}</span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-xl font-bold">{title}</p>
              <Chip tone={i < 2 ? "accent" : "soon"}>{status}</Chip>
            </div>
            <p className="mt-1.5 text-ink-2">{text}</p>
          </div>
        </Card>
      ))}
      <div className="flex flex-wrap gap-3 pt-3">
        {user ? (
          <>
            <Button onClick={openAlter}>Open ALTER</Button>
            <Button href="/profile" kind="outline">
              My AIs
            </Button>
          </>
        ) : (
          <Button onClick={() => continueWithAlt("signin", "/list-ai").catch(() => {})}>Continue with ALT</Button>
        )}
      </div>
    </NextStep>
  );
}
