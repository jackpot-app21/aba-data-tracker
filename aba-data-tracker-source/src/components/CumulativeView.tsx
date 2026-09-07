"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// Vista "Cumulativo": per ogni obiettivo che ha item/task sotto (obiettivi
// NON autosufficienti, es. "Ampliamento preferenze"), conta quante foglie
// (item senza task, oppure task) sono state ACQUISITE nel tempo e mostra la
// curva cumulativa delle acquisizioni.
//
// Regola di acquisizione (concordata):
// - Una foglia e' ACQUISITA quando il bambino risponde in modo 100%
//   spontaneo per 3 sessioni REGISTRATE consecutive.
// - "100% spontaneo" = nessuna risposta promptata (P = 0) e almeno 3
//   occasioni nella sessione (S >= 3).
// - La data di acquisizione e' la data della terza sessione della serie.
// - Una sessione che non rispetta la regola, prima dell'acquisizione,
//   azzera la serie. Una volta acquisita, la foglia resta acquisita.
// - I dati provengono da tutte le sessioni registrate (manuali o da foto).
const MIN_OCCASIONI = 3;
const STREAK_RICHIESTA = 3;
const GIORNI_SETTIMANA = 7;

const ACQ_COLOR = "#0b8f76"; // verde, coerente con le risposte spontanee (S)

type ObjectiveRow = { id: string; nome: string; archived: boolean };
type ItemRow = {
  id: string;
  objective_id: string;
  nome: string;
  archived: boolean;
};
type TaskRow = { id: string; item_id: string; nome: string; archived: boolean };
type TallyRow = {
  node_id: string;
  session_date: string;
  correct_count: number;
  prompted_count: number;
};

type Session = { date: string; correct: number; prompted: number };

type Target = {
  nodeId: string;
  nome: string;
  intro: string;
  acquired: string | null;
};

type CumulativePoint = { date: string; count: number };

type ObjectiveCumulative = {
  objectiveId: string;
  objectiveNome: string;
  targets: Target[];
  acquiredCount: number;
  points: CumulativePoint[];
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86400000);
}

function formatDateIt(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

// Calcola intro (prima sessione) e data di acquisizione per una foglia.
function computeTarget(
  nodeId: string,
  nome: string,
  sessions: Session[]
): Target {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const intro = sorted[0]?.date ?? "";
  let streak = 0;
  let acquired: string | null = null;
  for (const s of sorted) {
    const qualifies = s.prompted === 0 && s.correct >= MIN_OCCASIONI;
    if (qualifies) {
      streak += 1;
      if (streak >= STREAK_RICHIESTA) {
        acquired = s.date;
        break;
      }
    } else {
      streak = 0;
    }
  }
  return { nodeId, nome, intro, acquired };
}

export default function CumulativeView({ childId }: { childId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tallies, setTallies] = useState<TallyRow[]>([]);

  useEffect(() => {
    if (!supabase || !childId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      const [objsRes, itemsRes, tasksRes, talliesRes] = await Promise.all([
        supabase!
          .from("catalog_objectives")
          .select("id, nome, archived")
          .eq("archived", false),
        supabase!
          .from("catalog_items")
          .select("id, objective_id, nome, archived")
          .eq("archived", false),
        supabase!
          .from("catalog_tasks")
          .select("id, item_id, nome, archived")
          .eq("archived", false),
        supabase!
          .from("v_session_tally_detail")
          .select("node_id, session_date, correct_count, prompted_count")
          .eq("child_id", childId),
      ]);

      if (cancelled) return;

      const firstErr =
        objsRes.error || itemsRes.error || tasksRes.error || talliesRes.error;
      if (firstErr) {
        setError(firstErr.message);
        setLoading(false);
        return;
      }

      setObjectives((objsRes.data ?? []) as ObjectiveRow[]);
      setItems((itemsRes.data ?? []) as ItemRow[]);
      setTasks((tasksRes.data ?? []) as TaskRow[]);
      setTallies((talliesRes.data ?? []) as TallyRow[]);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [childId]);

  const objectivesCumulative = useMemo<ObjectiveCumulative[]>(() => {
    if (tallies.length === 0) return [];

    // Un item e' "foglia" se non ha task sotto.
    const itemHasTask = new Set<string>();
    tasks.forEach((t) => itemHasTask.add(t.item_id));

    const itemById = new Map(items.map((i) => [i.id, i]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const objById = new Map(objectives.map((o) => [o.id, o]));

    // Raggruppa i conteggi per nodo e per data (somma se piu' righe stessa data).
    const byNode = new Map<string, Map<string, Session>>();
    for (const r of tallies) {
      if (!r.session_date) continue;
      let perDate = byNode.get(r.node_id);
      if (!perDate) {
        perDate = new Map();
        byNode.set(r.node_id, perDate);
      }
      const ex = perDate.get(r.session_date);
      if (ex) {
        ex.correct += r.correct_count;
        ex.prompted += r.prompted_count;
      } else {
        perDate.set(r.session_date, {
          date: r.session_date,
          correct: r.correct_count,
          prompted: r.prompted_count,
        });
      }
    }

    const targetsByObjective = new Map<string, Target[]>();
    const lastDataByObjective = new Map<string, string>();

    byNode.forEach((perDate, nodeId) => {
      // Classifica il nodo: e' una foglia? A quale obiettivo appartiene?
      let objectiveId: string | null = null;
      let nome = "";

      const task = taskById.get(nodeId);
      if (task) {
        const item = itemById.get(task.item_id);
        if (!item) return;
        objectiveId = item.objective_id;
        nome = task.nome;
      } else {
        const item = itemById.get(nodeId);
        if (!item) return; // nodo obiettivo o non presente: ignorato
        if (itemHasTask.has(item.id)) return; // ha task: contano i task
        objectiveId = item.objective_id;
        nome = item.nome;
      }

      if (!objectiveId || !objById.has(objectiveId)) return;

      const sessions = Array.from(perDate.values());
      const target = computeTarget(nodeId, nome, sessions);

      const arr = targetsByObjective.get(objectiveId) ?? [];
      arr.push(target);
      targetsByObjective.set(objectiveId, arr);

      const maxDate = sessions.reduce(
        (m, s) => (s.date > m ? s.date : m),
        sessions[0].date
      );
      const prevLast = lastDataByObjective.get(objectiveId);
      if (!prevLast || maxDate > prevLast) {
        lastDataByObjective.set(objectiveId, maxDate);
      }
    });

    const result: ObjectiveCumulative[] = [];
    targetsByObjective.forEach((targets, objectiveId) => {
      const obj = objById.get(objectiveId);
      if (!obj) return;

      targets.sort((a, b) => a.intro.localeCompare(b.intro));
      const start = targets.reduce(
        (m, t) => (t.intro && t.intro < m ? t.intro : m),
        targets[0].intro
      );
      const lastData = lastDataByObjective.get(objectiveId) ?? start;

      const acqDates = targets
        .map((t) => t.acquired)
        .filter((d): d is string => Boolean(d));
      const countAcquiredBy = (date: string): number =>
        acqDates.reduce((n, d) => (d <= date ? n + 1 : n), 0);

      // Check settimanali: da start, +7 giorni, fino all'ultima data con dati.
      const points: CumulativePoint[] = [];
      let cur = start;
      let guard = 0;
      while (cur < lastData && guard < 520) {
        points.push({ date: cur, count: countAcquiredBy(cur) });
        cur = addDays(cur, GIORNI_SETTIMANA);
        guard += 1;
      }
      points.push({ date: lastData, count: countAcquiredBy(lastData) });

      result.push({
        objectiveId,
        objectiveNome: obj.nome,
        targets,
        acquiredCount: acqDates.length,
        points,
      });
    });

    result.sort((a, b) => b.targets.length - a.targets.length);
    return result;
  }, [tallies, items, tasks, objectives]);

  if (loading) {
    return (
      <p className="text-center text-ink-faint">Caricamento cumulativo...</p>
    );
  }
  if (error) {
    return <p className="text-center text-sm text-prompted">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl bg-mint-100 px-4 py-3 text-xs text-ink-soft">
        <p className="font-semibold text-ink-soft">
          Grafico cumulativo delle acquisizioni
        </p>
        <p className="mt-1">
          Un item/task e&apos;{" "}
          <span className="font-semibold text-correct">acquisito</span> quando
          il bambino risponde in modo 100% spontaneo (nessuna promptata, almeno
          3 occasioni) per 3 sessioni registrate di fila. Ogni acquisizione
          aggiunge 1 al conteggio; l&apos;asse delle date avanza di una settimana
          per volta dall&apos;inizio del lavoro sull&apos;obiettivo.
        </p>
      </div>

      {objectivesCumulative.length === 0 ? (
        <p className="text-center text-ink-faint">
          Nessun obiettivo con item/task registrati per questo bambino. Il
          cumulativo compare per gli obiettivi che hanno item o task sotto (es.
          Ampliamento preferenze).
        </p>
      ) : (
        objectivesCumulative.map((oc) => (
          <ObjectiveCumulativeCard key={oc.objectiveId} data={oc} />
        ))
      )}
    </div>
  );
}

function ObjectiveCumulativeCard({ data }: { data: ObjectiveCumulative }) {
  const total = data.targets.length;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{data.objectiveNome}</p>
        <p className="text-xs text-ink-faint">
          <span className="font-semibold text-correct">
            {data.acquiredCount}
          </span>{" "}
          acquisiti su {total}
        </p>
      </div>

      <CumulativeChart points={data.points} maxCount={total} />

      <TargetsTable targets={data.targets} />
    </div>
  );
}

function CumulativeChart({
  points,
  maxCount,
}: {
  points: CumulativePoint[];
  maxCount: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const padLeft = 26;
  const padRight = 16;
  const padTop = 12;
  const padBottom = 46;
  const plotHeight = 140;
  const height = plotHeight + padTop + padBottom;
  const stepX = 40;
  const width = Math.max(
    260,
    padLeft + padRight + stepX * Math.max(points.length - 1, 1) + 20
  );

  const yMax = Math.max(1, maxCount);
  const yTicks: number[] =
    yMax <= 6
      ? Array.from({ length: yMax + 1 }, (_, i) => i)
      : [0, Math.round(yMax / 2), yMax];

  function xAt(i: number) {
    return points.length > 1
      ? padLeft + (i * (width - padLeft - padRight)) / (points.length - 1)
      : padLeft + (width - padLeft - padRight) / 2;
  }
  function yAt(v: number) {
    return padTop + plotHeight - (v / yMax) * plotHeight;
  }

  // Linea a gradini (stepAfter): il conteggio sale nel punto in cui avviene
  // l'acquisizione e resta piatto fino al successivo.
  let path = "";
  points.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.count);
    if (i === 0) {
      path += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    } else {
      const prevY = yAt(points[i - 1].count);
      path += ` L ${x.toFixed(1)} ${prevY.toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  });

  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Andamento cumulativo degli item/task acquisiti nel tempo"
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

          {points.map((p, i) =>
            i % labelEvery === 0 || i === points.length - 1 ? (
              <text
                key={`x-${i}`}
                x={xAt(i)}
                y={height - padBottom + 14}
                textAnchor="end"
                fontSize={9}
                fill="#8aa39c"
                transform={`rotate(-40 ${xAt(i)} ${height - padBottom + 14})`}
              >
                {formatDateIt(p.date)}
              </text>
            ) : null
          )}

          {points.length > 1 && (
            <path
              d={path}
              fill="none"
              stroke={ACQ_COLOR}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {points.map((p, i) => {
            const isRise = i > 0 && p.count > points[i - 1].count;
            const r = hoverIdx === i ? 4.5 : isRise ? 3.5 : 2.5;
            return (
              <g key={`pt-${i}`}>
                <circle
                  cx={xAt(i)}
                  cy={yAt(p.count)}
                  r={r}
                  fill={ACQ_COLOR}
                  stroke="white"
                  strokeWidth={1.2}
                  className="pointer-events-none"
                />
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
          {formatDateIt(points[hoverIdx].date)} ·{" "}
          {points[hoverIdx].count}{" "}
          {points[hoverIdx].count === 1 ? "acquisito" : "acquisiti"}
        </div>
      )}
    </div>
  );
}

function TargetsTable({ targets }: { targets: Target[] }) {
  const sorted = [...targets].sort((a, b) => a.intro.localeCompare(b.intro));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="text-left text-ink-faint">
            <th className="py-1 pr-2 font-medium">Item / Task</th>
            <th className="py-1 pr-2 font-medium">Inizio</th>
            <th className="py-1 pr-2 font-medium">Acquisito</th>
            <th className="py-1 font-medium">Giorni</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const giorni =
              t.acquired && t.intro ? daysBetween(t.intro, t.acquired) : null;
            return (
              <tr key={t.nodeId} className="border-t border-line">
                <td className="py-1 pr-2 text-ink">{t.nome}</td>
                <td className="py-1 pr-2 text-ink-soft">
                  {t.intro ? formatDateIt(t.intro) : "-"}
                </td>
                <td className="py-1 pr-2">
                  {t.acquired ? (
                    <span className="font-semibold text-correct">
                      {formatDateIt(t.acquired)}
                    </span>
                  ) : (
                    <span className="text-ink-faint">in corso</span>
                  )}
                </td>
                <td className="py-1 text-ink-soft">
                  {giorni !== null ? giorni : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
