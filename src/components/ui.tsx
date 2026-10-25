import type { ReactNode } from "react";
import type { ModelRank } from "../../scripts/types";
import { formatScore, modelInitials, scoreChipClass, vendorTone } from "../lib/format";
import { vendorIcon } from "../lib/vendor-icons";

export function ScorePill({
  value,
  muted = false,
  className = "",
}: {
  value: number | null | undefined;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`score-pill ${muted ? "border-line bg-transparent text-muted" : scoreChipClass(value)} ${className}`}
    >
      {formatScore(value)}
    </span>
  );
}

export function ModelAvatar({
  name,
  vendor,
  size = "md",
}: {
  name: string;
  vendor: string;
  size?: "sm" | "md" | "lg";
}) {
  const color = vendorTone(vendor);
  const icon = vendorIcon(vendor);
  const sizes = {
    sm: "h-7 w-7 text-[9px]",
    md: "h-9 w-9 text-[10px]",
    lg: "h-12 w-12 text-xs",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-mono font-semibold tracking-tight ${sizes[size]}`}
      style={{
        color,
        backgroundColor: `${color}18`,
        borderColor: `${color}35`,
      }}
      aria-hidden="true"
      title={vendor}
    >
      {icon ? (
        <span
          className="block h-[58%] w-[58%]"
          style={{
            backgroundColor: color,
            maskImage: `url(${icon})`,
            WebkitMaskImage: `url(${icon})`,
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskPosition: "center",
            maskSize: "contain",
            WebkitMaskSize: "contain",
          }}
        />
      ) : (
        modelInitials(name)
      )}
    </span>
  );
}

export function CoverageMeter({
  model,
  allSourceIds,
  compact = false,
}: {
  model: ModelRank;
  allSourceIds: string[];
  compact?: boolean;
}) {
  const present = new Set(model.sources.map((source) => source.sourceId));
  const used = model.coverage.used;
  const total = allSourceIds.length;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="num text-[11px] text-muted">
          {used}/{total}
        </span>
        <span className="flex items-center gap-[2px]" aria-hidden="true">
          {allSourceIds.map((sourceId) => (
            <span
              key={sourceId}
              className={`h-2.5 w-[3px] rounded-full ${present.has(sourceId) ? "bg-accent" : "bg-line"}`}
            />
          ))}
        </span>
      </span>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">Source coverage</span>
        <span className="num text-xs text-muted">
          {used}/{total}
        </span>
      </div>
      <div className="flex items-center gap-1" aria-hidden="true">
        {allSourceIds.map((sourceId) => (
          <span
            key={sourceId}
            className={`h-2 flex-1 rounded-full ${present.has(sourceId) ? "bg-accent" : "bg-line"}`}
            title={sourceId}
          />
        ))}
      </div>
    </div>
  );
}

export function CategoryBar({
  label,
  value,
  rank,
  sources,
}: {
  label: string;
  value: number | null;
  rank: number | null;
  sources: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium">{label}</span>
        <span className="num text-xs text-muted">
          {value === null ? "not enough data" : `${formatScore(value)} · ${sources} src`}
        </span>
      </div>
      <div className="bar-track">
        <div
          className="bar-fill transition-[width] duration-500"
          style={{ width: `${value === null ? 0 : Math.max(2, value)}%`, opacity: value === null ? 0 : 1 }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted/70">
        <span>{rank ? `Rank #${rank} in category` : "Unranked"}</span>
        <span className="num">{value === null ? "—" : `${Math.round(value)} / 100`}</span>
      </div>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "green" }) {
  const classes = {
    neutral: "border-line bg-wash/60 text-muted",
    accent: "border-accent/20 bg-accent-soft text-accent-ink",
    green: "border-emerald-600/20 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${classes[tone]}`}>
      {children}
    </span>
  );
}
