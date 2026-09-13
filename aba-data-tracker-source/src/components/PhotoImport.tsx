"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import AddInline from "@/components/AddInline";
import DeleteMenu from "@/components/DeleteMenu";
import type {
  CatalogItem,
  CatalogObjective,
  CatalogTask,
  NodeLevel,
} from "@/lib/types";
import {
  currentMonthValue,
  parseMonthValue,
  weekRowsForMonth,
} from "@/lib/monthly-grid";

// Foglio "mensile a date precompilate" (branch vision-locale): il foglio
// cartaceo ha gia' le date stampate (Lun-Sab, tutto il mese), quindi qui non
// serve piu' leggere/indovinare la data ne' a mano ne' via AI: la deduciamo
// dalla posizione nella griglia una volta scelto il mese. Il tecnico guarda
// la foto come riferimento e trascrive le stanghette S/P nella colonna
// corrispondente al giorno della sessione. Le colonne senza sessione restano
// vuote e NON vengono salvate come zero (vedi handleSave).
//
// La lettura automatica via AI/computer vision (che in futuro potra' leggere
// direttamente stanghette e colonne dalla foto) non e' ancora ricollegata a
// questa nuova griglia: la foto resta per ora solo un riferimento visivo
// durante la trascrizione manuale. Verra' ricollegata quando la pipeline
// (Fase 1/2, vedi note di progetto) sara' pronta e testata su foto reali.
//
// IMPORTANTE: la foto NON viene mai salvata su database o storage. Vive solo
// in memoria nel browser (come riferimento durante la trascrizione) e viene
// scartata appena si salvano i dati numerici. Questo evita di accumulare
// spazio inutile e riduce al minimo i dati sensibili conservati (sui fogli
// cartacei puo' comparire scrittura a mano riconducibile a persone).
const MAX_IMAGE_EDGE = 1568;
const JPEG_QUALITY = 0.85;

type PhotoRow = {
  key: string; // == date (YYYY-MM-DD)
  date: string;
  dayName: string;
  dayLabel: string;
  correct: string;
  prompted: string;
};

function buildRowsForMonth(monthValue: string): PhotoRow[] {
  const parsed = parseMonthValue(monthValue);
  if (!parsed) return [];
  const weeks = weekRowsForMonth(parsed.year, parsed.month);
  const rows: PhotoRow[] = [];
  for (const week of weeks) {
    for (const day of week) {
      if (!day.inMonth) continue;
      rows.push({
        key: day.date,
        date: day.date,
        dayName: day.dayName,
        dayLabel: day.dayLabel,
        correct: "",
        prompted: "",
      });
    }
  }
  return rows;
}

async function resizeImage(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Impossibile elaborare l'immagine su questo dispositivo.");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const mimeType = "image/jpeg";
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Conversione immagine fallita."))),
      mimeType,
      JPEG_QUALITY
    );
  });

  return { blob, mimeType };
}

export default function PhotoImport({
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
  const [objectiveId, setObjectiveId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [monthValue, setMonthValue] = useState<string>(() => currentMonthValue());
  const [rows, setRows] = useState<PhotoRow[]>(() => buildRowsForMonth(currentMonthValue()));
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const weekRows = useMemo(() => {
    const parsed = parseMonthValue(monthValue);
    if (!parsed) return [];
    return weekRowsForMonth(parsed.year, parsed.month);
  }, [monthValue]);

  useEffect(() => {
    setRows(buildRowsForMonth(monthValue));
    setSuccessCount(null);
  }, [monthValue]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function loadObjectives() {
      const { data, error: err } = await supabase!
        .from("catalog_objectives")
        .select("id, nome, archived")
        .eq("archived", false)
        .order("nome", { ascending: true });

      if (!cancelled) {
        if (err) setError(err.message);
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
      const { data, error: err } = await supabase!
        .from("catalog_items")
        .select("id, objective_id, nome, archived")
        .eq("objective_id", objectiveId)
        .eq("archived", false)
        .order("nome", { ascending: true });

      if (!cancelled) {
        if (err) setError(err.message);
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
      const { data, error: err } = await supabase!
        .from("catalog_tasks")
        .select("id, item_id, nome, archived")
        .eq("item_id", itemId)
        .eq("archived", false)
        .order("nome", { ascending: true });

      if (!cancelled) {
        if (err) setError(err.message);
        else setCatalogTasks((data ?? []) as CatalogTask[]);
      }
    }

    loadTasks();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

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
    const { data, error: err } = await supabase
      .from("catalog_objectives")
      .insert({ nome: name })
      .select("id, nome, archived")
      .single();

    if (err) {
      setError(err.message);
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
    const { data, error: err } = await supabase
      .from("catalog_items")
      .insert({ objective_id: objectiveId, nome: name })
      .select("id, objective_id, nome, archived")
      .single();

    if (err) {
      setError(err.message);
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
    const { data, error: err } = await supabase
      .from("catalog_tasks")
      .insert({ item_id: itemId, nome: name })
      .select("id, item_id, nome, archived")
      .single();

    if (err) {
      setError(err.message);
      return;
    }
    const newTask = data as CatalogTask;
    setCatalogTasks((prev) =>
      [...prev, newTask].sort((a, b) => a.nome.localeCompare(b.nome))
    );
    setTaskId(newTask.id);
  }

  // "Elimina" per il catalogo non cancella mai lo storico: marca il nodo
  // come archiviato, cosi' sparisce dalla selezione per tutti i terapisti
  // ma resta collegato ai conteggi gia' salvati.
  async function deleteObjective(id: string) {
    if (!supabase) return;
    const { error: err } = await supabase
      .from("catalog_objectives")
      .update({ archived: true })
      .eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    setCatalogObjectives((prev) => prev.filter((o) => o.id !== id));
    if (objectiveId === id) setObjectiveId(null);
  }

  async function deleteItem(id: string) {
    if (!supabase) return;
    const { error: err } = await supabase
      .from("catalog_items")
      .update({ archived: true })
      .eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    setCatalogItems((prev) => prev.filter((i) => i.id !== id));
    if (itemId === id) setItemId(null);
  }

  async function deleteTask(id: string) {
    if (!supabase) return;
    const { error: err } = await supabase
      .from("catalog_tasks")
      .update({ archived: true })
      .eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    setCatalogTasks((prev) => prev.filter((t) => t.id !== id));
    if (taskId === id) setTaskId(null);
  }

  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSuccessCount(null);
    setError(null);

    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoBlob(null);
    setPhotoMimeType(null);
    setPhotoPreviewUrl(null);

    if (!file) return;

    try {
      const { blob, mimeType } = await resizeImage(file);
      setPhotoBlob(blob);
      setPhotoMimeType(mimeType);
      setPhotoPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossibile elaborare la foto selezionata."
      );
    }
  }

  function updateRow(key: string, patch: Partial<PhotoRow>) {
    setSuccessCount(null);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    if (!supabase || !activeNodeId || !activeLevel || !photoBlob || !photoMimeType) return;

    // Le colonne che il terapista non ha toccato (nessuna sessione quel
    // giorno) restano fuori dal salvataggio: non vanno mai lette come 0.
    // Solo le colonne dove S e/o P sono stati compilati diventano una
    // sessione salvata.
    const validRows = rows.filter(
      (r) => r.correct.trim() !== "" || r.prompted.trim() !== ""
    );
    if (validRows.length === 0) {
      setError(
        "Compila i conteggi S/P di almeno un giorno prima di salvare."
      );
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessCount(null);

    try {
      // La foto NON viene caricata su storage ne' registrata in photo_imports:
      // usiamo solo i dati numerici confermati dal terapista. L'immagine resta
      // in memoria (photoBlob) e viene scartata subito dopo il salvataggio.
      let savedCount = 0;

      for (const row of validRows) {
        const correct = parseInt(row.correct, 10) || 0;
        const prompted = parseInt(row.prompted, 10) || 0;

        const { data: existingSession } = await supabase
          .from("sessions")
          .select("id")
          .eq("child_id", childId)
          .eq("session_date", row.date)
          .maybeSingle();

        let sessionId = (existingSession as { id: string } | null)?.id;

        if (!sessionId) {
          const { data: created, error: createError } = await supabase
            .from("sessions")
            .insert({
              child_id: childId,
              session_date: row.date,
              therapist_id: therapistId,
              source: "photo_import",
              confirmed_at: new Date().toISOString(),
            })
            .select("id")
            .single();

          if (createError || !created) {
            setError(createError?.message ?? "Errore nella creazione della sessione.");
            continue;
          }
          sessionId = (created as { id: string }).id;
        }

        const { error: tallyError } = await supabase.from("session_tallies").upsert(
          {
            session_id: sessionId,
            node_id: activeNodeId,
            node_level: activeLevel,
            correct_count: correct,
            prompted_count: prompted,
          },
          { onConflict: "session_id,node_id" }
        );

        if (tallyError) {
          setError(tallyError.message);
          continue;
        }

        savedCount += 1;
      }

      setSuccessCount(savedCount);
      if (savedCount > 0) {
        setRows(buildRowsForMonth(monthValue));
        if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
        setPhotoBlob(null);
        setPhotoMimeType(null);
        setPhotoPreviewUrl(null);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink-soft">
        Scegli il mese, poi trascrivi nella griglia qui sotto i conteggi S/P
        di ogni giorno in cui si è svolta una sessione, usando la foto del
        foglio cartaceo come riferimento. I giorni senza sessione restano
        vuoti: non contano come zero. La foto non viene salvata da nessuna
        parte: resta solo sul dispositivo durante la trascrizione e sparisce
        appena salvi i dati.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Obiettivo
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
                onClick={() => setObjectiveId(node.id)}
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
                  onClick={() => setItemId(node.id)}
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
                  onClick={() => setTaskId(node.id)}
                />
              </DeleteMenu>
            ))}
            <AddInline label="Aggiungi Nuovo" onAdd={addTask} />
          </div>
        </section>
      )}

      <div className="min-h-[1.5rem] text-center text-sm italic text-ink-soft">
        {activeNodeId
          ? `Stai importando dati per: ${breadcrumb}`
          : "Seleziona un obiettivo (ed eventualmente item/task) per continuare"}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Mese
        </h2>
        <input
          type="month"
          value={monthValue}
          onChange={(e) => setMonthValue(e.target.value)}
          className="w-fit rounded-lg border border-line px-3 py-2 text-sm focus:border-mint-500 focus:outline-none"
        />
        <p className="text-xs text-ink-faint">
          Deve corrispondere al mese stampato sul foglio cartaceo che stai
          trascrivendo.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Foto del foglio (riferimento)
        </h2>
        <div className="flex flex-wrap gap-2">
          {/* Due input distinti: "capture" forza la fotocamera su molti
              browser mobile (soprattutto Android) e nasconde l'opzione
              galleria dal selettore di sistema, quindi serve un secondo
              input senza "capture" per poter scegliere una foto gia'
              scattata. */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
            className="hidden"
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white"
          >
            Scatta foto
          </button>
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink-soft hover:border-mint-200"
          >
            Scegli dalla galleria
          </button>
        </div>
        {photoPreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoPreviewUrl}
            alt="Anteprima foglio cartaceo"
            className="max-h-96 w-auto rounded-lg border border-line object-contain"
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Conteggi per data
        </h2>

        <div className="flex flex-col gap-2">
          {weekRows.map((week, wi) => (
            <div key={wi} className="grid grid-cols-6 gap-1.5">
              {week.map((day) => {
                if (!day.inMonth) {
                  return (
                    <div
                      key={day.date}
                      className="rounded-md bg-line/20"
                      aria-hidden
                    />
                  );
                }
                const row = rows.find((r) => r.date === day.date);
                if (!row) return <div key={day.date} />;
                const touched =
                  row.correct.trim() !== "" || row.prompted.trim() !== "";
                return (
                  <div
                    key={day.date}
                    className={`flex flex-col items-center gap-1 rounded-md p-1.5 ${
                      touched ? "bg-mint-100" : "bg-line/10"
                    }`}
                  >
                    <span className="text-[10px] font-semibold text-ink-soft">
                      {day.dayName} {day.dayLabel}
                    </span>
                    <label className="flex items-center gap-1 text-[10px] text-ink-soft">
                      S
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={row.correct}
                        onChange={(e) =>
                          updateRow(row.key, { correct: e.target.value })
                        }
                        className="w-10 rounded border border-line px-1 py-0.5 text-xs text-correct focus:border-mint-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-ink-soft">
                      P
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={row.prompted}
                        onChange={(e) =>
                          updateRow(row.key, { prompted: e.target.value })
                        }
                        className="w-10 rounded border border-line px-1 py-0.5 text-xs text-prompted focus:border-mint-500 focus:outline-none"
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-faint">
          I giorni evidenziati hanno almeno un conteggio inserito. Quelli
          bianchi restano vuoti e non verranno salvati.
        </p>
      </section>

      {error && <p className="text-center text-sm text-prompted">{error}</p>}
      {successCount !== null && successCount > 0 && (
        <p className="text-center text-sm text-mint-600">
          {successCount === 1
            ? "1 sessione salvata correttamente."
            : `${successCount} sessioni salvate correttamente.`}
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !activeNodeId || !photoBlob}
        className="font-display mx-auto flex items-center gap-2 rounded-full bg-ink px-8 py-3 text-base font-bold text-white shadow-md transition active:scale-95 disabled:opacity-50"
      >
        {saving ? "Salvataggio..." : "Salva dati dalla foto"}
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
