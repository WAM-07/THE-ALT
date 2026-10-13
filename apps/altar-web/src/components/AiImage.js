"use client";

// An AI's picture from ALT, or its initials on ALTAR green when it has none.
export default function AiImage({ model, className = "w-full h-full object-cover", textClassName = "text-2xl" }) {
  if (model?.image) return <img src={model.image} alt={String(model.name || "AI")} className={className} />;
  const initials = String(model?.name || "AI")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className={`${className} flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(34,197,94,0.35),transparent_60%),linear-gradient(135deg,#052e16,#000)]`}>
      <span className={`${textClassName} font-black tracking-tighter text-green-300/90`}>{initials}</span>
    </div>
  );
}
