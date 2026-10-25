import type { BenchmarkModelPoint } from "../../scripts/costs";
import type { MetaCostPoint, ModelRank } from "../../scripts/types";

export interface PlotPoint {
  id: string;
  model: ModelRank;
  x: number;
  y: number;
  frontier: boolean;
  meta?: MetaCostPoint;
  ensemble?: BenchmarkModelPoint;
}

export const WIDTH = 900;
export const HEIGHT = 410;
export const MARGIN = { left: 64, right: 30, top: 35, bottom: 65 };
export const PERCENTILE_TICKS = [0, 20, 40, 60, 80, 100];

export function plotScale(points: PlotPoint[]) {
  const xs = points.map((point) => point.x);
  let minLog = Math.floor(Math.log10(xs.length ? Math.min(...xs) : 0.1));
  let maxLog = Math.ceil(Math.log10(xs.length ? Math.max(...xs) : 10));
  if (maxLog === minLog) { minLog -= 0.5; maxLog += 0.5; }
  const minY = 0;
  const maxY = 100;
  const x = (value: number) => MARGIN.left + (Math.log10(value) - minLog) / (maxLog - minLog) * (WIDTH - MARGIN.left - MARGIN.right);
  const y = (value: number) => HEIGHT - MARGIN.bottom - (value - minY) / (maxY - minY) * (HEIGHT - MARGIN.top - MARGIN.bottom);
  let xTicks: number[] = [];
  for (let power = Math.floor(minLog); power <= Math.ceil(maxLog); power += 1) {
    for (const factor of [1, 2, 5]) {
      const value = factor * 10 ** power;
      if (Math.log10(value) >= minLog && Math.log10(value) <= maxLog) xTicks.push(value);
    }
  }
  if (xTicks.length > 9) xTicks = xTicks.filter((_, index) => index % 2 === 0);
  const yTicks = Array.from({ length: 6 }, (_, index) => minY + (maxY - minY) * index / 5);
  return { x, y, xTicks, yTicks };
}

/** Fixed 0-100 scales for the benchmark-normalized ensemble view. */
export function percentileScale() {
  const x = (value: number) => MARGIN.left + value / 100 * (WIDTH - MARGIN.left - MARGIN.right);
  const y = (value: number) => HEIGHT - MARGIN.bottom - value / 100 * (HEIGHT - MARGIN.top - MARGIN.bottom);
  return { x, y, xTicks: PERCENTILE_TICKS, yTicks: PERCENTILE_TICKS };
}

export function pointLabels(points: PlotPoint[], x: (value: number) => number, y: (value: number) => number) {
  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  return points.filter((point) => point.frontier).flatMap((point) => {
    const anchor = x(point.x) > WIDTH * 0.7 ? "end" : "start";
    const tx = x(point.x) + (anchor === "end" ? -10 : 10);
    const width = point.model.name.length * 5.5;
    for (const offset of [-13, 20, -29, 36]) {
      const ty = y(point.y) + offset;
      const box = { left: anchor === "end" ? tx - width : tx, right: anchor === "end" ? tx : tx + width, top: ty - 11, bottom: ty + 3 };
      if (box.top < 5 || box.bottom > HEIGHT - MARGIN.bottom - 5 || occupied.some((other) => box.left < other.right + 5 && box.right + 5 > other.left && box.top < other.bottom + 3 && box.bottom + 3 > other.top)) continue;
      occupied.push(box);
      return [{ id: point.id, text: point.model.name, x: tx, y: ty, anchor }];
    }
    return [];
  });
}
