"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { buildChildReportPdf } from "@/lib/report-pdf";
import DeleteMenu from "@/components/DeleteMenu";
import CumulativeView from "@/components/CumulativeView";
import type {
  NodeLevel,
  NodeSessionPoint,
  NodeSummary,
  TallyDetailRow,
} from "@/lib/types";

export default function ReportView({
  childId,
  childLabel,
}: {
  childId: string;
  childLabel: string;
}) {
  const [rows, setRows] = useState<TallyDetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"presa" | "cumulativo">("presa");

  // Un obiettivo/item/task eliminato (archiviato) da REGISTRA non deve piu'
  // comparire nemmeno qui, per nessun terapista: senza questo filtro
  // resterebbe visibile perche' la vista v_session_tally_detail non
  // considera lo stato "archived". Caricato una volta al montaggio: dato
  // che questa sezione viene smontata cambiando tab, tornare su Andamento
  // rilegge sempre lo stato aggiornato.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function loadArchived() {
      const [{ data: objs }, { data: items }, { data: tasks }] =
        await Promise.all([
          supabase!.from("catalog_objectives").select("id").eq("archived", true),
          supabase!.from("catalog_items").select("id").eq("archived", true),
          supabase!.from("catalog_tasks").select("id").eq("archived", true),
        ]);

      if (cancelled) return;
      const ids = new Set<string>();
      (objs ?? []).forEach((o: { id: string }) => ids.add(o.id));
      (items ?? []).forEach((i: { id: string }) => ids.add(i.id));
      (tasks ?? []).forEach((t: { id: string }) => ids.add(t.id));
      setArchivedIds(ids);
    }

    loadArchived();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDeleteNode(level: NodeLevel, nodeId: string) {
    if (!supabase) return;
    const table =
      level === "objective"
        ? "catalog_objectives"
        : level === "item"
          ? "catalog_items"
          : "catalog_tasks";

    const { error: updateError } = await supabase
      .from(table)
      .update({ archived: true })
      .eq("id", nodeId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setArchivedIds((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
  }

  useEffect(() => {
    if (!supabase || !childId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      let query = supabase!
        .from("v_session_tally_detail")
        .select("*")
        .eq("child_id", childId)
        .order("session_date", { ascending: true });

      if (fromDate) query = query.gte("session_date", fromDate);
      if (toDate) query = query.lte("session_date", toDate);

      const { data, error: fetchError } = await query;
      if (!cancelled) {
        if (fetchError) setError(fetchError.message);
        else setRows((data ?? []) as TallyDetailRow[]);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [childId, fromDate, toDate]);

  const summaries = useMemo<NodeSummary[]>(() => {
    const map = new Map<string, NodeSummary>();

    for (const row of rows) {
      if (archivedIds.has(row.node_id)) continue;
      const key = `${row.node_level}:${row.node_id}`;
      const point: NodeSessionPoint = {
        session_date: row.session_date,
        correct_count: row.correct_count,
        prompted_count: row.prompted_count,
      };

      const existing = map.get(key);
      if (existing) {
        existing.total_correct += row.correct_count;
        existing.total_prompted += row.prompted_count;
        existing.session_count += 1;
        existing.points.push(point);
      } else {
        map.set(key, {
          node_level: row.node_level,
          node_id: row.node_id,
          breadcrumb: buildBreadcrumb(row),
          total_correct: row.correct_count,
          total_prompted: row.prompted_count,
          session_count: 1,
          points: [point],
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) =>
        b.total_correct + b.total_prompted - (a.total_correct + a.total_prompted)
    );
  }, [rows, archivedIds]);

  async function handleExportPdf() {
    setExporting(true);
    try {
      await buildChildReportPdf({ childLabel, fromDate, toDate, summaries });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border border-line bg-white p-0.5">
          <ModeButton
            label="Presa dati"
            active={mode === "presa"}
            onClick={() => setMode("presa")}
          />
          <ModeButton
            label="Cumulativo"
            active={mode === "cumulativo"}
            onClick={() => setMode("cumulativo")}
          />
        </div>
      </div>

      {mode === "cumulativo" ? (
        <CumulativeView childId={childId} />
      ) : loading ? (
        <p className="text-center text-ink-faint">Caricamento andamento...</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl bg-mint-100 px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                Dal
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded-lg border border-line px-2 py-1 text-sm focus:border-mint-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                Al
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded-lg border border-line px-2 py-1 text-sm focus:border-mint-500 focus:outline-none"
                />
              </label>
              {(fromDate || toDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                  }}
                  className="text-xs text-ink-faint underline"
                >
                  Azzera filtro
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exporting || summaries.length === 0}
              className="font-display rounded-full bg-ink px-5 py-2 text-sm font-bold text-white transition active:scale-95 disabled:opacity-40"
            >
              {exporting ? "Generazione PDF..." : "Scarica PDF"}
            </button>
          </div>

          {error && (
            <p className="text-center text-sm text-prompted">{error}</p>
          )}

          {summaries.length === 0 ? (
            <p className="text-center text-ink-faint">
              Nessun dato registrato per questo bambino nell&apos;intervallo
              selezionato.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {summaries.map((summary) => (
                <DeleteMenu
                  key={`${summary.node_level}:${summary.node_id}`}
                  confirmLabel={`Eliminare "${summary.breadcrumb}" dall'andamento? Sparira' dai grafici e dalla selezione in Registra per tutti i terapisti.`}
                  onDelete={() =>
                    handleDeleteNode(summary.node_level, summary.node_id)
                  }
                >
                  <NodeCard summary={summary} />
                </DeleteMenu>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-mint-500 text-white"
          : "text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function buildBreadcrumb(row: TallyDetailRow): string {
  if (row.node_level === "objective") {
    return row.node_nome ?? "Obiettivo eliminato";
  }
  if (row.node_level === "item") {
    return (
      [row.objective_nome, row.node_nome].filter(Boolean).join(" > ") ||
      "Item eliminato"
    );
  }
  return (
    [row.objective_nome, row.item_nome, row.node_nome]
      .filter(Boolean)
      .join(" > ") || "Task eliminato"
  );
}

function NodeCard({ summary }: { summary: NodeSummary }) {
  const total = summary.total_correct + summary.total_prompted;
  const percent = total > 0 ? Math.round((summary.total_correct / total) * 100) : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-ink">
          {summary.breadcrumb}
        </p>
        <p className="text-xs text-ink-faint">
          {summary.session_count}{" "}
          {summary.session_count === 1 ? "sessione" : "sessioni"}
        </p>
      </div>

      <div className="flex items-center gap-4 text-sm text-ink-soft">
        <span>
          S:{" "}
          <span className="font-semibold text-correct">
            {summary.total_correct}
          </span>
        </span>
        <span>
          P:{" "}
          <span className="font-semibold text-prompted">
            {summary.total_prompted}
          </span>
        </span>
        {percent !== null && <span>{percent}% spontanee</span>}
      </div>

      <TrendChart points={summary.points} />
    </div>
  );
}

// Verde/rosso coerenti con i colori gia' usati nei pulsanti +/- dell'app
// (bg-correct / bg-prompted in tailwind.config.ts).
const S_COLOR = "#0b8f76";
const P_COLOR = "#e2483f";

function TrendChart({ points }: { points: NodeSessionPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const padLeft = 30;
  const padRight = 14;
  const padTop = 12;
  const padBottom = 46;
  const plotHeight = 140;
  const height = plotHeight + padTop + padBottom;
  const stepX = 44;
  const width = Math.max(
    260,
    padLeft + padRight + stepX * Math.max(points.length - 1, 0) + 20
  );

  const maxValue = Math.max(
    1,
    ...points.flatMap((p) => [p.correct_count, p.prompted_count])
  );
  const yMax = niceCeiling(maxValue);
  const yTicks = [0, Math.round(yMax / 2), yMax];

  function xAt(i: number) {
    return points.length > 1
      ? padLeft + (i * (width - padLeft - padRight)) / (points.length - 1)
      : padLeft + (width - padLeft - padRight) / 2;
  }
  function yAt(value: number) {
    return padTop + plotHeight - (value / yMax) * plotHeight;
  }

  const sPath = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.correct_count).toFixed(1)}`
    )
    .join(" ");
  const pPath = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.prompted_count).toFixed(1)}`
    )
    .join(" ");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ backgroundColor: S_COLOR }}
          />
          S (spontanee)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4"
            style={{
              backgroundImage: `repeating-linear-gradient(to right, ${P_COLOR} 0 4px, transparent 4px 7px)`,
            }}
          />
          P (promptate)
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Andamento delle risposte spontanee (S) e promptate (P) nel tempo"
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={yAt(t)}
                y2={yAt(t)}
                stroke="#dceee7"
                strokeWidth={1}
              />
              <text
                x={padLeft - 6}
                y={yAt(t) + 3}
                textAnchor="end"
                fontSize={9}
                fill="#8aa39c"
              >
                {t}
              </text>
            </g>
          ))}

          {points.map((p, i) => (
            <text
              key={`x-${i}`}
              x={xAt(i)}
              y={height - padBottom + 14}
              textAnchor="end"
              fontSize={9}
              fill="#8aa39c"
              transform={`rotate(-40 ${xAt(i)} ${height - padBottom + 14})`}
            >
              {formatDateShort(p.session_date)}
            </text>
          ))}

          {points.length > 1 && (
            <>
              <path
                d={sPath}
                fill="none"
                stroke={S_COLOR}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={pPath}
                fill="none"
                stroke={P_COLOR}
                strokeWidth={2}
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {points.map((p, i) => {
            const r = hoverIdx === i ? 4.5 : 3;
            return (
              <g key={`pt-${i}`}>
                <circle
                  cx={xAt(i)}
                  cy={yAt(p.correct_count)}
                  r={r}
                  fill={S_COLOR}
                  stroke="white"
                  strokeWidth={1.2}
                  className="pointer-events-none"
                />
                <rect
                  x={xAt(i) - r}
                  y={yAt(p.prompted_count) - r}
                  width={r * 2}
                  height={r * 2}
                  fill={P_COLOR}
                  stroke="white"
                  strokeWidth={1.2}
                  className="pointer-events-none"
                />
                {/* target di hover piu' ampio della coppia di marcatori */}
                <rect
                  x={xAt(i) - 10}
                  y={padTop}
                  width={20}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                  className="cursor-pointer"
                />
              </g>
            );
          })}

          {hoverIdx !== null && (
            <line
              x1={xAt(hoverIdx)}
              x2={xAt(hoverIdx)}
              y1={padTop}
              y2={padTop + plotHeight}
              stroke="#a9c9c0"
              strokeWidth={1}
            />
          )}
        </svg>
      </div>

      {hoverIdx !== null && (
        <div className="w-fit rounded-md bg-ink px-2 py-1 text-xs text-white">
          {formatDateShort(points[hoverIdx].session_date)} · S:{" "}
          {points[hoverIdx].correct_count} · P: {points[hoverIdx].prompted_count}
        </div>
      )}
    </div>
  );
}

function niceCeiling(value: number): number {
  if (value <= 5) return 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  let niceNormalized: number;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

function formatDateShort(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}
