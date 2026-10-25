import type { Category, CostStatistic, LeaderboardDataset, ModelRank, TaskCost } from "../../scripts/types";

export const CATEGORY_ORDER: Category[] = ["general", "coding", "agentic", "reasoning"];

export const CATEGORY_COPY: Record<Category, { label: string; description: string }> = {
  general: {
    label: "General",
    description: "Broad capability: expert knowledge, reasoning, and human preference.",
  },
  coding: {
    label: "Coding",
    description: "Software engineering, terminal work, web development, and code optimization.",
  },
  agentic: {
    label: "Agentic",
    description: "Tool use, long-horizon tasks, and adapting to unfamiliar environments.",
  },
  reasoning: {
    label: "Reasoning",
    description: "Hard problem solving, expert questions, and novel environments.",
  },
};

export function formatScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : "—";
}

export function formatScoreOne(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "—";
}

export function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude > 0 && magnitude < 0.000001) return `$${value.toExponential(2)}`;
  const digits = magnitude === 0 || magnitude >= 1 ? 2 : magnitude >= 0.01 ? 3 : magnitude >= 0.0001 ? 4 : 6;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value);
}

export function formatTaskCost(cost: TaskCost): string {
  return `${cost.upperBound ? "<" : ""}${formatUsd(cost.usd)}/${cost.unit}`;
}

export function formatCostIndex(value: number): string {
  return `${value < 0.01 ? value.toPrecision(2) : value.toFixed(value >= 100 ? 1 : 2)}×`;
}

export function formatPercentile(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  const mod100 = rounded % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : (["th", "st", "nd", "rd"][rounded % 10] ?? "th");
  return `${rounded}${suffix}`;
}

export function costStatisticLabel(statistic: CostStatistic): string {
  return statistic === "median" ? "P50" : statistic === "weighted-mean" ? "Weighted mean" : "Mean";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function scoreTone(value: number | null | undefined): "high" | "mid" | "low" | "none" {
  if (typeof value !== "number" || !Number.isFinite(value)) return "none";
  if (value >= 75) return "high";
  if (value >= 50) return "mid";
  return "low";
}

export function scoreChipClass(value: number | null | undefined): string {
  switch (scoreTone(value)) {
    case "high":
      return "border-emerald-600/20 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300";
    case "mid":
      return "border-amber-600/20 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case "low":
      return "border-rose-600/20 bg-rose-500/10 text-rose-800 dark:text-rose-300";
    default:
      return "border-line bg-transparent text-muted";
  }
}

export function sourceName(dataset: LeaderboardDataset, sourceId: string): string {
  return dataset.sources.find((source) => source.id === sourceId)?.shortName ?? sourceId;
}

export function rankedModels(dataset: LeaderboardDataset): ModelRank[] {
  return dataset.models.filter((model) => model.status === "ranked");
}

/** Ranks every model with a meta score, ignoring the official coverage floor. */
export function rankAllModels(models: ModelRank[]): Map<string, number> {
  const ranked = models
    .filter((model) => model.overall !== null)
    .sort((a, b) => {
      if (b.overall! !== a.overall!) return b.overall! - a.overall!;
      if (b.coverage.used !== a.coverage.used) return b.coverage.used - a.coverage.used;
      return a.name.localeCompare(b.name);
    });
  return new Map(ranked.map((model, index) => [model.id, index + 1]));
}

export function topModel(dataset: LeaderboardDataset): ModelRank | undefined {
  return rankedModels(dataset)[0];
}

export function modelInitials(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function vendorTone(vendor: string): string {
  const map: Record<string, string> = {
    Anthropic: "#d97757",
    OpenAI: "#139b78",
    Google: "#4285f4",
    Meta: "#0866ff",
    Moonshot: "#8b5cf6",
    DeepSeek: "#4d6bfe",
    "Z.ai": "#0ea5e9",
    Alibaba: "#f59e0b",
    Xiaomi: "#f97316",
    MiniMax: "#ec4899",
    SpaceXAI: "#94a3b8",
    Mistral: "#f97316",
    StepFun: "#10b981",
    Reflection: "#6366f1",
    "Thinking Machines": "#14b8a6",
    NVIDIA: "#76b900",
    Tencent: "#3b82f6",
    "Institute of Foundation Models": "#8b5cf6",
  };
  return map[vendor] ?? "#6b7280";
}
