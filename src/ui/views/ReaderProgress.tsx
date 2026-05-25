// src/ui/views/ReaderProgress.tsx
// §9.5 — Chart.js stacked bars + doughnut ring. No per-week sparkline in v1.

import { useEffect, useRef } from "react";

export type SectionBar = {
  section: string;
  pending: number;
  reading: number;
  reviewed: number;
  skip: number;
};
export type StatusMixSlice = {
  status: "pending" | "reading" | "reviewed" | "skip";
  count: number;
};
export type ReaderProgressProps = {
  stats: { bySection: SectionBar[]; statusMix: StatusMixSlice[] };
};

export function ReaderProgress({ stats }: ReaderProgressProps) {
  const barRef = useRef<HTMLCanvasElement | null>(null);
  const ringRef = useRef<HTMLCanvasElement | null>(null);
  // Chart.js instance refs — use loose type to avoid pulling the heavy Chart.js
  // type tree into SSR import context.
  const barChart = useRef<{ destroy: () => void } | null>(null);
  const ringChart = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    if (!barRef.current || typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      const { default: Chart } = await import("chart.js/auto");
      if (cancelled || !barRef.current) return;
      barChart.current?.destroy();
      barChart.current = new Chart(barRef.current, {
        type: "bar",
        data: {
          labels: stats.bySection.map((s) => s.section || "(no section)"),
          datasets: (["pending", "reading", "reviewed", "skip"] as const).map(
            (status) => ({
              label: status,
              data: stats.bySection.map((s) => s[status]),
              stack: "status",
            }),
          ),
        },
        options: {
          responsive: true,
          scales: { x: { stacked: true }, y: { stacked: true } },
        },
      });
    })().catch(() => {});
    return () => {
      cancelled = true;
      barChart.current?.destroy();
      barChart.current = null;
    };
  }, [stats.bySection]);

  useEffect(() => {
    if (!ringRef.current || typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      const { default: Chart } = await import("chart.js/auto");
      if (cancelled || !ringRef.current) return;
      ringChart.current?.destroy();
      ringChart.current = new Chart(ringRef.current, {
        type: "doughnut",
        data: {
          labels: stats.statusMix.map((s) => s.status),
          datasets: [{ data: stats.statusMix.map((s) => s.count) }],
        },
        options: { responsive: true },
      });
    })().catch(() => {});
    return () => {
      cancelled = true;
      ringChart.current?.destroy();
      ringChart.current = null;
    };
  }, [stats.statusMix]);

  return (
    <div data-view="progress" style={{ padding: "1rem" }}>
      <h3>Reader progress</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: "1rem",
        }}
      >
        <div>
          <h4>Papers by section</h4>
          <canvas ref={barRef} />
        </div>
        <div>
          <h4>Status mix</h4>
          <canvas ref={ringRef} />
        </div>
      </div>
    </div>
  );
}
