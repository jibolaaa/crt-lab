"use client";
import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesMarker, SeriesType, Time, UTCTimestamp } from "lightweight-charts";
import type { Trade } from "../engine";

export interface Candles { t: number[]; o: number[]; h: number[]; l: number[]; c: number[] }

// Boxes and short level lines drawn on the chart, placed by candle index.
interface Shape { kind: "box" | "level"; i1: number; i2: number; p1: number; p2: number; fill?: string; stroke: string; dash?: number[] }
interface Target { useBitmapCoordinateSpace: (f: (s: { context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number }) => void) => void }

class Shapes implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  constructor(private shapes: Shape[]) {}
  attached(p: SeriesAttachedParameter<Time>) { this.chart = p.chart; this.series = p.series; }
  detached() { this.chart = null; this.series = null; }
  paneViews() {
    const self = this;
    return [{
      zOrder: () => "bottom" as const,
      renderer: () => ({
        draw(target: Target) {
          const chart = self.chart, series = self.series;
          if (!chart || !series) return;
          const ts = chart.timeScale();
          target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
            for (const s of self.shapes) {
              // the chart only places whole bars, so widen by half the bar spacing by hand
              const a = ts.logicalToCoordinate(s.i1 as Logical), b = ts.logicalToCoordinate(s.i2 as Logical);
              const next = ts.logicalToCoordinate((s.i2 + 1) as Logical);
              const y1 = series.priceToCoordinate(s.p1), y2 = series.priceToCoordinate(s.p2);
              if (a === null || b === null || y1 === null || y2 === null) continue;
              const half = next !== null ? Math.abs(next - b) / 2 : 0;
              const left = Math.round((Math.min(a, b) - half) * hr), right = Math.round((Math.max(a, b) + half) * hr);
              if (s.kind === "box") {
                const top = Math.round(Math.min(y1, y2) * vr), h = Math.max(1, Math.round(Math.abs(y2 - y1) * vr));
                ctx.fillStyle = s.fill ?? "transparent";
                ctx.fillRect(left, top, right - left, h);
                ctx.strokeStyle = s.stroke;
                ctx.lineWidth = Math.max(1, Math.floor(hr));
                ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, h - 1);
              } else {
                const y = Math.round(y1 * vr) + 0.5;
                ctx.strokeStyle = s.stroke;
                ctx.lineWidth = Math.max(1, Math.round(1.5 * hr));
                ctx.setLineDash((s.dash ?? []).map((d) => d * hr));
                ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
                ctx.setLineDash([]);
              }
            }
          });
        }
      })
    }];
  }
}

/** Index of the last candle starting at or before t. */
function at(t: number[], time: number) {
  let lo = 0, hi = t.length - 1, ans = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m] <= time) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

export function TradeChart({ trade, candles, digits }: { trade: Trade; candles: Candles | null; digits: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!candles || !el || !candles.t.length) return;
    let chart: IChartApi | null = null;
    let gone = false;
    import("lightweight-charts").then((lc) => {
      if (gone) return;
      const css = getComputedStyle(document.documentElement);
      const v = (name: string) => css.getPropertyValue(name).trim();
      const [up, down, gold, paper, fog, rule] = ["--up", "--down", "--gold", "--paper", "--fog", "--rule"].map(v);
      chart = lc.createChart(el, {
        autoSize: true,
        layout: { background: { type: lc.ColorType.Solid, color: "transparent" }, textColor: fog, fontSize: 11, fontFamily: getComputedStyle(document.body).fontFamily },
        grid: { vertLines: { color: "rgba(44,55,70,0.45)" }, horzLines: { color: "rgba(44,55,70,0.45)" } },
        rightPriceScale: { borderColor: rule, scaleMargins: { top: 0.08, bottom: 0.08 } },
        timeScale: { borderColor: rule, timeVisible: true, secondsVisible: false, rightOffset: 2 },
        crosshair: { mode: lc.CrosshairMode.Normal },
        localization: { locale: "en-GB", priceFormatter: (p: number) => p.toFixed(digits) }
      });
      const series = chart.addSeries(lc.CandlestickSeries, {
        upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false,
        priceLineVisible: false, lastValueVisible: false,
        priceFormat: { type: "price", precision: digits, minMove: 10 ** -digits }
      });
      const T = candles.t;
      series.setData(T.map((t, i) => ({ time: t as UTCTimestamp, open: candles.o[i], high: candles.h[i], low: candles.l[i], close: candles.c[i] })));

      const long = trade.dir === 1;
      const line = (price: number, color: string, title: string, dashed = false) =>
        series.createPriceLine({ price, color, title, lineWidth: 1, lineStyle: dashed ? lc.LineStyle.Dashed : lc.LineStyle.Solid, axisLabelVisible: true });
      line(trade.rangeHigh, fog, "High");
      line(trade.rangeLow, fog, "Low");
      line(trade.mid, gold, "50%", true);
      line(trade.entry, paper, "Entry");
      line(trade.stop, down, "Stop", true);
      line(trade.tp2, up, "Target");

      const iEntry = at(T, trade.entryT - 1);
      const shapes: Shape[] = [];
      if (trade.keyLevel) {
        // the higher-timeframe level the sweep reached, from the start of the chart to the entry
        shapes.push({ kind: "box", i1: at(T, trade.keyLevel.t), i2: iEntry, p1: trade.keyLevel.top, p2: trade.keyLevel.bottom, fill: "rgba(154,163,176,0.12)", stroke: "rgba(154,163,176,0.55)" });
      }
      const q = trade.qm;
      if (trade.zone && !q) {
        const start = Math.min(trade.zone.ob?.t ?? Infinity, trade.zone.fvg?.t ?? Infinity, trade.zone.t);
        shapes.push({ kind: "box", i1: at(T, start), i2: iEntry, p1: trade.zone.top, p2: trade.zone.bottom, fill: "rgba(227,176,75,0.13)", stroke: "rgba(227,176,75,0.55)" });
      }
      const m1 = trade.m1;
      if (m1) {
        // Model 1: the swing the MSS closed through, and the inducement up to the fill
        shapes.push({ kind: "level", i1: at(T, m1.mssFrom), i2: at(T, trade.mssT - 1), p1: trade.mssLevel, p2: trade.mssLevel, stroke: paper, dash: [4, 3] });
        shapes.push({ kind: "level", i1: at(T, m1.idmT), i2: iEntry, p1: m1.idm, p2: m1.idm, stroke: gold, dash: [5, 3] });
      } else if (q) {
        // the QM line from the shoulder to the fill, and the level the shift closed through
        shapes.push({ kind: "level", i1: at(T, q.shoulderT), i2: iEntry, p1: q.level, p2: q.level, stroke: gold, dash: [5, 3] });
        shapes.push({ kind: "level", i1: at(T, q.headT), i2: at(T, q.smsT - 1), p1: q.smsLevel, p2: q.smsLevel, stroke: paper, dash: [4, 3] });
      } else {
        shapes.push({ kind: "level", i1: at(T, trade.mssT), i2: iEntry, p1: trade.mssLevel, p2: trade.mssLevel, stroke: paper, dash: [4, 3] });
        // retest: the order block the BOS left, where the limit sat
        if (trade.retest) shapes.push({ kind: "box", i1: at(T, trade.retest.obT), i2: iEntry, p1: trade.retest.top, p2: trade.retest.bottom, fill: "rgba(236,230,214,0.10)", stroke: "rgba(236,230,214,0.5)" });
      }
      series.attachPrimitive(new Shapes(shapes));

      const markers: SeriesMarker<Time>[] = [
        { time: T[at(T, trade.sweepT)] as UTCTimestamp, position: long ? "belowBar" : "aboveBar", shape: long ? "arrowUp" : "arrowDown", color: gold, text: "Sweep" },
        { time: T[iEntry] as UTCTimestamp, position: long ? "belowBar" : "aboveBar", shape: long ? "arrowUp" : "arrowDown", color: paper, text: "In" }
      ];
      if (q) markers.push({ time: T[at(T, q.headT)] as UTCTimestamp, position: long ? "belowBar" : "aboveBar", shape: "circle", color: gold, text: "A" });
      if (m1) markers.push({ time: T[at(T, trade.mssT - 1)] as UTCTimestamp, position: long ? "aboveBar" : "belowBar", shape: "circle", color: paper, text: "MSS" });
      if (trade.partialT) markers.push({ time: T[at(T, trade.partialT)] as UTCTimestamp, position: long ? "aboveBar" : "belowBar", shape: "circle", color: gold, text: "Half" });
      const iExit = at(T, trade.exitT - (trade.reason === "time" || trade.reason === "end" ? 1 : 0));
      markers.push({ time: T[iExit] as UTCTimestamp, position: long ? "aboveBar" : "belowBar", shape: "square", color: trade.r > 0.005 ? up : trade.r < -0.005 ? down : fog, text: "Out" });
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      lc.createSeriesMarkers(series, markers);

      const first = Math.min(at(T, trade.sweepT), q ? at(T, q.shoulderT) : Infinity, m1 ? at(T, m1.mssFrom) : Infinity);
      const from = Math.max(0, first - (m1 ? 24 : 12)), to = Math.min(T.length - 1, iExit + 6);
      chart.timeScale().setVisibleLogicalRange({ from, to });
    });
    return () => { gone = true; chart?.remove(); };
  }, [trade, candles, digits]);
  return <div ref={box} style={{ position: "absolute", inset: 0 }} />;
}
