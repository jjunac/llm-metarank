import { ExternalLink } from "lucide-react";
import type { TaskCost } from "../../scripts/types";
import { costStatisticLabel, formatDate, formatTaskCost, formatUsd } from "../lib/format";

export default function TaskCostDetail({ cost }: { cost: TaskCost }) {
  return (
    <div className="mt-3 border-t border-line/70 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[10px]">
        <span className="text-muted">{costStatisticLabel(cost.statistic)} task cost</span>
        <span className="num text-xs font-semibold text-ink">{formatTaskCost(cost)}</span>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted/80">
        {cost.scope} · {cost.method === "usage-estimate" ? "Usage-based estimate" : cost.method === "total-over-attempts" ? "Spend ÷ all attempts" : "Source-reported"}
        {!cost.complete && " · Incomplete run; excluded from frontier"}
        {cost.upperBound && " · Upper bound; excluded from frontier"}
      </p>
      {cost.totalUsd !== undefined && cost.attempts !== undefined && (
        <p className="num mt-1 text-[10px] text-muted">{formatUsd(cost.totalUsd)} ÷ {cost.attempts.toLocaleString("en-US")} attempts</p>
      )}
      <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[10px] text-muted/70">
        <span>Cost retrieved {formatDate(cost.fetchedAt)}</span>
        <a href={cost.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
          Cost data <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
      {(cost.breakdown?.length || cost.notes?.length || cost.dataUrl) ? (
        <details className="mt-2 text-[10px] text-muted">
          <summary className="focus-ring cursor-pointer rounded-sm hover:text-ink">Calculation and caveats</summary>
          {cost.breakdown && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-[10px]">
                <thead><tr className="border-b border-line"><th className="py-1 font-medium">Evaluation</th><th className="px-2 py-1 text-right font-medium">Tasks</th><th className="px-2 py-1 text-right font-medium">Weight</th><th className="py-1 text-right font-medium">$/task</th></tr></thead>
                <tbody>{cost.breakdown.map((item) => (
                  <tr key={item.label} className="border-b border-line/50 last:border-0">
                    <td className="py-1">{item.label}</td><td className="num px-2 py-1 text-right">{item.tasks ?? "—"}</td>
                    <td className="num px-2 py-1 text-right">{item.weight === undefined ? "by tasks" : `${Math.round(item.weight * 100)}%`}</td>
                    <td className="num py-1 text-right">{formatUsd(item.usdPerTask)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {cost.notes?.map((note) => <p key={note} className="mt-2 leading-4">{note}</p>)}
          {cost.dataUrl && <p className="mt-2 break-all leading-4">Data endpoint ({cost.dataMethod ?? "GET"}): <code>{cost.dataUrl}</code></p>}
          {cost.methodologyUrl && <a href={cost.methodologyUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-accent hover:underline">Source methodology ↗</a>}
        </details>
      ) : null}
    </div>
  );
}
