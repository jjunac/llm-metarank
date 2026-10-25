export const CATEGORIES = ["general", "coding", "agentic", "reasoning"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  general: "General",
  coding: "Coding",
  agentic: "Agentic",
  reasoning: "Reasoning",
};

export type SourceAccess = "html" | "json" | "api" | "browser";
export type CostScope = "overall" | Category;
export type CostStatistic = "mean" | "weighted-mean" | "median";

/** A cost for the exact score/variant on the containing entry, never a token price. */
export interface TaskCost {
  usd: number;
  currency: "USD";
  unit: "task" | "environment";
  statistic: CostStatistic;
  method: "reported" | "total-over-attempts" | "usage-estimate";
  scope: string;
  sourceUrl: string;
  /** Machine-readable provenance when it differs from the human-readable source page. */
  dataUrl?: string;
  dataMethod?: "GET" | "POST";
  methodologyUrl?: string;
  fetchedAt: string;
  complete: boolean;
  /** A displayed upper bound is not an exact point and cannot enter a frontier. */
  upperBound?: boolean;
  totalUsd?: number;
  attempts?: number;
  notes?: string[];
  breakdown?: Array<{ label: string; usdPerTask: number; weight?: number; tasks?: number }>;
}

export interface SnapshotCostStatus {
  status: "available" | "not-reported" | "unavailable";
  note: string;
  url?: string;
}

export interface SourceConfig {
  id: string;
  name: string;
  shortName: string;
  url: string;
  access: SourceAccess;
  metricLabel: string;
  scoreType: "percent" | "elo" | "index" | "score";
  description: string;
  categories: Partial<Record<Category, string>>;
  weight: number;
  composite?: boolean;
  accent: string;
  note?: string;
  costMethodology?: {
    statistic?: CostStatistic;
    url: string;
    note: string;
  };
}

export interface RawEntry {
  /** The model name exactly as shown by the source, after light cleanup. */
  rawName: string;
  /** Primary score used for the overall ranking. */
  score: number;
  /** Optional sub-scores, e.g. LiveBench category scores. */
  metrics?: Record<string, number>;
  /** Reasoning effort, eval mode, or other variant label. */
  variant?: string;
  /** Agent/scaffold used by the source, when applicable. */
  harness?: string;
  /** Date attached to this specific result, if any. */
  date?: string;
  /** Deep link to the source row/page, if different from the source URL. */
  url?: string;
  /** Vendor as reported by the source. */
  vendor?: string;
  /** Source's run identifier, not the canonical model identifier. */
  runId?: string;
  cost?: TaskCost;
  /** Costs matching category sub-scores, not the source's overall task mix. */
  metricCosts?: Record<string, TaskCost>;
  costUnavailableReason?: string;
  /** Kept separately when the source does not publish a verified task denominator. */
  runCostUsd?: number;
  /** Free-form source-specific data kept for auditing. */
  extra?: Record<string, unknown>;
}

export interface SourceSnapshot {
  sourceId: string;
  fetchedAt: string;
  sourceUpdatedAt?: string;
  url: string;
  entries: RawEntry[];
  warnings: string[];
  costStatus?: SnapshotCostStatus;
}

export interface CanonicalModel {
  id: string;
  name: string;
  vendor: string;
  releaseDate?: string;
  openWeights?: boolean;
  aliases?: string[];
  /** Regex patterns matched against normalized raw names. First match wins. */
  patterns?: string[];
  note?: string;
}

export interface NormalizedSourceEntry {
  sourceId: string;
  rawName: string;
  modelId: string;
  score: number;
  metrics: Record<string, number>;
  percentile: number;
  metricPercentiles: Record<string, number>;
  variant?: string;
  harness?: string;
  date?: string;
  url: string;
  sourceSize: number;
  rankInSource: number;
  runId?: string;
  cost?: TaskCost;
  metricCosts?: Record<string, TaskCost>;
  costUnavailableReason?: string;
  runCostUsd?: number;
}

export interface CategoryScore {
  score: number | null;
  rank: number | null;
  sources: number;
  sourceIds: string[];
}

export interface ModelRank {
  id: string;
  name: string;
  vendor: string;
  releaseDate?: string;
  openWeights?: boolean;
  overall: number | null;
  rank: number | null;
  coverage: {
    used: number;
    total: number;
    general: number;
    coding: number;
    agentic: number;
    reasoning: number;
  };
  categories: Record<Category, CategoryScore>;
  sources: NormalizedSourceEntry[];
  /** All cost-bearing configurations; the main ranking still selects the best score. */
  costedRuns: NormalizedSourceEntry[];
  missingSourceIds: string[];
  status: "ranked" | "limited";
}

export interface DatasetSource extends SourceConfig {
  dataDate: string;
  fetchedAt: string;
  entryCount: number;
  mappedCount: number;
  warnings: string[];
  status: "current" | "stale";
  costCoverage: {
    status: "available" | "partial" | "not-reported" | "unavailable" | "stale";
    reportedEntries: number;
    mappedModels: number;
    usableModels: number;
    runTotalEntries: number;
    statistics: CostStatistic[];
    note: string;
    url?: string;
  };
}

export interface CostBaseline {
  sourceId: string;
  metric: string;
  statistic: CostStatistic;
  usd: number;
  models: number;
}

export interface MetaCostPoint {
  modelId: string;
  score: number;
  /** Dimensionless: 1× is the geometric mean of benchmark reference costs. */
  costIndex: number;
  frontier: boolean;
  dominatedBy: string[];
  contributions: Array<{
    sourceId: string;
    metric: string;
    runId?: string;
    percentile: number;
    costUsd: number;
    statistic: CostStatistic;
    referenceUsd: number;
    weight: number;
  }>;
}

export interface MetaCostFrontier {
  scope: CostScope;
  sourceIds: string[];
  points: MetaCostPoint[];
  excluded: Array<{ modelId: string; missingSourceIds: string[] }>;
}

export interface CostBasket {
  /** Canonical, order-independent source-set id: sorted source ids joined with "+". */
  id: string;
  /** Sources in display order. */
  sourceIds: string[];
}

export interface CostAnalysis {
  /** References are fixed at build time and never recomputed by search/vendor filters. */
  baselines: CostBaseline[];
  /** Current mean-cost sources that can enter a multi-source matched basket for each scope. */
  applicableSourceIds: Record<CostScope, string[]>;
  /** Sources with at least two paired models for a single-benchmark view, including P50 sources. */
  singleSourceIds: Record<CostScope, string[]>;
  /** Every supported multi-source matched basket, largest eligible set first. */
  baskets: Record<CostScope, CostBasket[]>;
  defaultBasketId: Partial<Record<CostScope, string>>;
  /** One independent multi-source frontier per matched basket. Points are never compared across baskets. */
  frontiers: Record<CostScope, Record<string, MetaCostFrontier>>;
  /** Independent one-benchmark frontiers. Median/P50 sources are allowed here and never pooled with means. */
  singleSourceFrontiers: Record<CostScope, Record<string, MetaCostFrontier>>;
}

export interface LeaderboardDataset {
  generatedAt: string;
  methodologyVersion: string;
  sourceCount: number;
  trackedModelCount: number;
  rankedModelCount: number;
  sources: DatasetSource[];
  models: ModelRank[];
  categorySources: Record<Category, string[]>;
  costAnalysis: CostAnalysis;
}
