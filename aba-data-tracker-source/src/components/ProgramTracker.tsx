"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import AddInline from "@/components/AddInline";
import DeleteMenu from "@/components/DeleteMenu";
import type {
  CatalogItem,
  CatalogObjective,
  CatalogTask,
  NodeLevel,
  SessionInfo,
  TallyCount,
} from "@/lib/types";

const SAVE_DEBOUNCE_MS = 600;

export default function ProgramTracker({
  childId,
  therapistId,
}: {
  childId: string;
  therapistId: string | null;
}) {
  const [catalogObjectives, setCatalogObjectives] = useState<
    CatalogObjective[]
  >([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogTasks, setCatalogTasks] = useState<CatalogTask[]>([]);

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [tallies, setTallies] = useState<Record<string, TallyCount>>({});
  const [objectiveId, setObjectiveId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingSession, setSavingSession] = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingSave = useRef<Record<string, () => Promise<void>>>({});
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
  }, [session]);

  const flushPending = useCallback(async () => {
    Object.values(saveTimers.current).forEach((timer) => clearTimeout(timer));
    const saves = Object.values(pendingSave.current).map((save) => save());
    saveTimers.current = {};
    pendingSave.current = {};
    await Promise.all(saves);
  }, []);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") flushPending();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", flushPending);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", flushPending);
      flushPending();
    };
  }, [flushPending]);

  // Catalogo globale di obiettivi: condiviso tra tutti i bambini, caricato
  // una sola volta. Item e task si caricano invece "a cascata" in base a
  // cosa viene selezionato.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function loadObjectives() {
      const { data, error } = await supabase!
        .from("catalog_objectives")
        .select("id, nome, archived")
        .eq("archived", false)
        .order("nome", { ascending: true });

      if (!cancelled) {
        if (error) setSaveError(error.message);
        else setCatalogObjectives((data ?? []) as CatalogObjective[]);
      }
    }

    loadObjectives();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setItemId(null);
    setTaskId(null);
    setCatalogItems([]);

    if (!supabase || !objectiveId) return;
    let cancelled = false;

    async function loadItems() {
      const { data, error } = await supabase!
        .from("catalog_items")
        .select("id, objective_id, nome, archived")
        .eq("objective_id", objectiveId)
        .eq("archived", false)
        .order("nome", { ascending: true });

      if (!cancelled) {
        if (error) setSaveError(error.message);
        else setCatalogItems((data ?? []) as CatalogItem[]);
      }
    }

    loadItems();
    return () => {
      cancelled = true;
    };
  }, [objectiveId]);

  useEffect(() => {
    setTaskId(null);
    setCatalogTasks([]);

    if (!supabase || !itemId) return;
    let cancelled = false;

    async function loadTasks() {
      const { data, error } = await supabase!
        .from("catalog_tasks")
        .select("id, item_id, nome, archived")
        .eq("item_id", itemId)
        .eq("archived", false)
        .order("nome", { ascending: true });

      if (!cancelled) {
        if (error) setSaveError(error.message);
        else setCatalogTasks((data ?? []) as CatalogTask[]);
      }
    }

    loadTasks();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // Sessione del giorno per il bambino selezionato + conteggi gia' salvati.
  useEffect(() => {
    setObjectiveId(null);
    setItemId(null);
    setTaskId(null);
    setTallies({});
    setSession(null);
    setSaveError(null);
    setSavedJustNow(false);

    if (!supabase || !childId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existingSession } = await supabase!
        .from("sessions")
        .select("id, session_date, confirmed_at")
        .eq("child_id", childId)
        .eq("session_date", today)
        .maybeSingle();

      let sessionRow: SessionInfo | null =
        (existingSession as SessionInfo | null) ?? null;

      if (!sessionRow) {
        const { data: created, error: createError } = await supabase!
          .from("sessions")
          .insert({
            child_id: childId,
            session_date: today,
            therapist_id: therapistId,
            source: "manual",
          })
          .select("id, session_date, confirmed_at")
          .single();

        if (createError) {
          if (!cancelled) setSaveError(createError.message);
        } else {
          sessionRow = created as SessionInfo;
        }
      }

      if (sessionRow && !cancelled) {
        setSession(sessionRow);
        const { data: tallyRows } = await supabase!
          .from("session_tallies")
          .select("node_id, correct_count, prompted_count")
          .eq("session_id", sessionRow.id);

        const map: Record<string, TallyCount> = {};
        (tallyRows ?? []).forEach(
          (row: {
            node_id: string;
            correct_count: number;
            prompted_count: number;
          }) => {
            map[row.node_id] = {
              correct_count: row.correct_count,
              prompted_count: row.prompted_count,
            };
          }
        );
        setTallies(map);
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [childId, therapistId]);

  const activeLevel: NodeLevel | null = taskId
    ? "task"
    : itemId
      ? "item"
      : objectiveId
        ? "objective"
        : null;
  const activeNodeId = taskId ?? itemId ?? objectiveId;

  const breadcrumb = [
    catalogObjectives.find((o) => o.id === objectiveId)?.nome,
    catalogItems.find((i) => i.id === itemId)?.nome,
    catalogTasks.find((t) => t.id === taskId)?.nome,
  ]
    .filter((name): name is string => Boolean(name))
    .join(" > ");

  async function addObjective(name: string) {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("catalog_objectives")
      .insert({ nome: name })
      .select("id, nome, archived")
      .single();

    if (error) {
      setSaveError(error.message);
      return;
    }

    const newObjective = data as CatalogObjective;
    setCatalogObjectives((prev) =>
      [...prev, newObjective].sort((a, b) => a.nome.localeCompare(b.nome))
    );
    setObjectiveId(newObjective.id);
  }

  async function addItem(name: string) {
    if (!supabase || !objectiveId) return;
    const { data, error } = await supabase
      .from("catalog_items")
      .insert({ objective_id: objectiveId, nome: name })
      .select("id, objective_id, nome, archived")
      .single();

    if (error) {
      setSaveError(error.message);
      return;
    }

    const newItem = data as CatalogItem;
    setCatalogItems((prev) =>
      [...prev, newItem].sort((a, b) => a.nome.localeCompare(b.nome))
    );
    setItemId(newItem.id);
  }

  async function addTask(name: string) {
    if (!supabase || !itemId) return;
    const { data, error } = await supabase
      .from("catalog_tasks")
      .insert({ item_id: itemId, nome: name })
      .select("id, item_id, nome, archived")
      .single();

    if (error) {
      setSaveError(error.message);
      return;
    }

    const newTask = data as CatalogTask;
    setCatalogTasks((prev) =>
      [...prev, newTask].sort((a, b) => a.nome.localeCompare(b.nome))
    );
    setTaskId(newTask.id);
  }

  // "Elimina" per il catalogo non cancella mai lo storico: marca il nodo
  // come archiviato (stesso campo gia' usato per filtrare le liste), cosi'
  // sparisce dalla selezione per tutti i terapisti ma resta collegato ai
  // conteggi gia' salvati.
  async function deleteObjective(id: string) {
    if (!supabase) return;
    const { error } = await supabase
      .from("catalog_objectives")
      .update({ archived: true })
      .eq("id", id);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setCatalogObjectives((prev) => prev.filter((o) => o.id !== id));
    if (objectiveId === id) {
      flushPending();
      setObjectiveId(null);
    }
  }

  async function deleteItem(id: string) {
    if (!supabase) return;
    const { error } = await supabase
      .from("catalog_items")
      .update({ archived: true })
      .eq("id", id);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setCatalogItems((prev) => prev.filter((i) => i.id !== id));
    if (itemId === id) {
      flushPending();
      setItemId(null);
    }
  }

  async function deleteTask(id: string) {
    if (!supabase) return;
    const { error } = await supabase
      .from("catalog_tasks")
      .update({ archived: true })
      .eq("id", id);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setCatalogTasks((prev) => prev.filter((t) => t.id !== id));
    if (taskId === id) {
      flushPending();
      setTaskId(null);
    }
  }

  function scheduleSave(nodeId: string, level: NodeLevel, value: TallyCount) {
    if (saveTimers.current[nodeId]) {
      clearTimeout(saveTimers.current[nodeId]);
    }
    const doSave = async () => {
      const sid = sessionIdRef.current;
      delete saveTimers.current[nodeId];
      delete pendingSave.current[nodeId];
      if (!sid || !supabase) return;
      const { error } = await supabase.from("session_tallies").upsert(
        {
          session_id: sid,
          node_id: nodeId,
          node_level: level,
          correct_count: value.correct_count,
          prompted_count: value.prompted_count,
        },
        { onConflict: "session_id,node_id" }
      );
      setSaveError(error ? "Errore di salvataggio, riprova." : null);
    };
    pendingSave.current[nodeId] = doSave;
    saveTimers.current[nodeId] = setTimeout(doSave, SAVE_DEBOUNCE_MS);
  }

  function bump(kind: "correct" | "prompted") {
    if (!activeNodeId || !activeLevel || !supabase) return;
    const targetId = activeNodeId;
    const targetLevel = activeLevel;
    setSavedJustNow(false);
    setTallies((prev) => {
      const current = prev[targetId] ?? {
        correct_count: 0,
        prompted_count: 0,
      };
      const next =
        kind === "correct"
          ? { ...current, correct_count: current.correct_count + 1 }
          : { ...current, prompted_count: current.prompted_count + 1 };
      scheduleSave(targetId, targetLevel, next);
      return { ...prev, [targetId]: next };
    });
  }

  function selectObjective(id: string) {
    flushPending();
    setObjectiveId(id);
  }

  function selectItem(id: string) {
    flushPending();
    setItemId(id);
  }

  function selectTask(id: string) {
    flushPending();
    setTaskId(id);
  }

  async function handleSalva() {
    if (!supabase || !session) return;
    setSavingSession(true);
    setSaveError(null);
    try {
      await flushPending();
      const confirmedAt = new Date().toISOString();
      const { error } = await supabase
        .from("sessions")
        .update({ confirmed_at: confirmedAt })
        .eq("id", session.id);

      if (error) {
        setSaveError(error.message);
        return;
      }

      setSession((prev) => (prev ? { ...prev, confirmed_at: confirmedAt } : prev));
      setSavedJustNow(true);
    } finally {
      setSavingSession(false);
    }
  }

  if (loading) {
    return <p className="text-center text-ink-faint">Caricamento...</p>;
  }

  const activeCounts = activeNodeId
    ? (tallies[activeNodeId] ?? { correct_count: 0, prompted_count: 0 })
    : null;
  const activeTotal = activeCounts
    ? activeCounts.correct_count + activeCounts.prompted_count
    : 0;
  const activePercent =
    activeCounts && activeTotal > 0
      ? Math.round((activeCounts.correct_count / activeTotal) * 100)
      : null;

  const sessionDateLabel = session
    ? new Date(`${session.session_date}T00:00:00`).toLocaleDateString(
        "it-IT",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      )
    : null;
  const confirmedTimeLabel = session?.confirmed_at
    ? new Date(session.confirmed_at).toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-mint-100 px-4 py-2 text-sm">
        <span className="font-medium capitalize text-ink-soft">
          {sessionDateLabel ?? "Sessione odierna"}
        </span>
        <span
          className={
            confirmedTimeLabel
              ? "font-medium text-mint-600"
              : "text-ink-faint"
          }
        >
          {confirmedTimeLabel
            ? `Salvata alle ${confirmedTimeLabel}`
            : "Non ancora salvata"}
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Obiettivi
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {catalogObjectives.map((node) => (
            <DeleteMenu
              key={node.id}
              confirmLabel={`Eliminare l'obiettivo "${node.nome}"? Non sara' piu' selezionabile per nessun terapista (lo storico resta nell'andamento finche' non lo elimini anche li').`}
              onDelete={() => deleteObjective(node.id)}
            >
              <Pill
                label={node.nome}
                selected={node.id === objectiveId}
                onClick={() => selectObjective(node.id)}
              />
            </DeleteMenu>
          ))}
          <AddInline label="Aggiungi Nuovo" onAdd={addObjective} />
        </div>
      </section>

      {objectiveId && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Item
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {catalogItems.map((node) => (
              <DeleteMenu
                key={node.id}
                confirmLabel={`Eliminare l'item "${node.nome}"? Non sara' piu' selezionabile per nessun terapista (lo storico resta nell'andamento finche' non lo elimini anche li').`}
                onDelete={() => deleteItem(node.id)}
              >
                <Pill
                  label={node.nome}
                  selected={node.id === itemId}
                  onClick={() => selectItem(node.id)}
                />
              </DeleteMenu>
            ))}
            <AddInline label="Aggiungi Nuovo" onAdd={addItem} />
          </div>
        </section>
      )}

      {itemId && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Task
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {catalogTasks.map((node) => (
              <DeleteMenu
                key={node.id}
                confirmLabel={`Eliminare il task "${node.nome}"? Non sara' piu' selezionabile per nessun terapista (lo storico resta nell'andamento finche' non lo elimini anche li').`}
                onDelete={() => deleteTask(node.id)}
              >
                <Pill
                  label={node.nome}
                  selected={node.id === taskId}
                  onClick={() => selectTask(node.id)}
                />
              </DeleteMenu>
            ))}
            <AddInline label="Aggiungi Nuovo" onAdd={addTask} />
          </div>
        </section>
      )}

      <div className="min-h-[1.5rem] text-center text-sm italic text-ink-soft">
        {activeNodeId
          ? `Stai registrando: ${breadcrumb}`
          : "Seleziona un obiettivo per iniziare"}
      </div>

      {saveError && (
        <p className="text-center text-sm text-prompted">{saveError}</p>
      )}

      <div className="flex flex-col items-center gap-4">
        <div className="flex gap-10">
          <button
            type="button"
            disabled={!activeNodeId}
            onClick={() => bump("correct")}
            className="flex h-32 w-32 items-center justify-center rounded-full bg-correct text-5xl font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-30"
            aria-label="Risposta spontanea"
          >
            +
          </button>
          <button
            type="button"
            disabled={!activeNodeId}
            onClick={() => bump("prompted")}
            className="flex h-32 w-32 items-center justify-center rounded-full bg-prompted text-5xl font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-30"
            aria-label="Risposta promptata"
          >
            -
          </button>
        </div>

        {activeCounts && (
          <p className="text-sm text-ink-soft">
            S: <span className="font-semibold text-correct">{activeCounts.correct_count}</span>
            {" · "}
            P: <span className="font-semibold text-prompted">{activeCounts.prompted_count}</span>
            {activePercent !== null ? ` · ${activePercent}% spontanee` : ""}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleSalva}
        disabled={savingSession || !session}
        className="font-display mx-auto flex items-center gap-2 rounded-full bg-ink px-8 py-3 text-base font-bold text-white shadow-md transition active:scale-95 disabled:opacity-50"
      >
        {savingSession
          ? "Salvataggio..."
          : savedJustNow
            ? "Sessione salvata ✓"
            : "Salva sessione"}
      </button>
    </div>
  );
}

function Pill({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition ${
        selected
          ? "border-mint-500 bg-mint-500 text-white"
          : "border-line bg-white text-ink-soft hover:border-mint-200"
      }`}
    >
      {label}
    </button>
  );
}
