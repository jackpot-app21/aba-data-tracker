"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import AddInline from "@/components/AddInline";
import DeleteMenu from "@/components/DeleteMenu";
import type {
  CatalogItem,
  CatalogObjective,
  CatalogTask,
  NodeLevel,
} from "@/lib/types";

// Scenario B: foto del foglio cartaceo -> lettura automatica delle
// stanghette via Claude (vision) -> bozza modificabile -> salvataggio.
// La lettura automatica e' sempre una proposta: il tecnico ABA la rivede
// e corregge prima di salvare, non viene mai salvata a occhi chiusi.
//
// IMPORTANTE: la foto NON viene mai salvata su database o storage. Vive solo
// in memoria nel browser (per la lettura automatica e l'anteprima durante la
// revisione) e viene scartata appena si salvano i dati numerici. Questo evita
// di accumulare spazio inutile e riduce al minimo i dati sensibili conservati
// (sui fogli cartacei puo' comparire scrittura a mano riconducibile a persone).
const MAX_IMAGE_EDGE = 1568; // limite consigliato per l'analisi vision
const JPEG_QUALITY = 0.85;

type PhotoRow = {
  key: string;
  date: string;
  dateLabel: string;
  correct: string;
  prompted: string;
  uncertain: boolean;
};

type ExtractedRow = {
  date_iso: string | null;
  date_label: string;
  correct_count: number;
  prompted_count: number;
  uncertain: boolean;
};

function newRow(): PhotoRow {
  return {
    key: crypto.randomUUID(),
    date: "",
    dateLabel: "",
    correct: "",
    prompted: "",
    uncertain: false,
  };
}

async function resizeImage(
  file: File
): Promise<{ blob: Blob; base64: string; mimeType: string }> {
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

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Lettura immagine fallita."));
    reader.readAsDataURL(blob);
  });

  return { blob, base64, mimeType };
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
  const [rows, setRows] = useState<PhotoRow[]>([newRow()]);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

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

  async function runExtraction(base64: string, mimeType: string) {
    setExtracting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/extract-tally", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error ?? "Lettura automatica non riuscita. Inserisci i dati manualmente."
        );
        return;
      }

      const extracted = (data.rows ?? []) as ExtractedRow[];
      if (extracted.length === 0) {
        setNotice(
          "Non ho trovato colonne leggibili nella foto. Inserisci i dati manualmente qui sotto."
        );
        return;
      }

      setRows(
        extracted.map((r) => ({
          key: crypto.randomUUID(),
          date: r.date_iso ?? "",
          dateLabel: r.date_label ?? "",
          correct: String(r.correct_count ?? 0),
          prompted: String(r.prompted_count ?? 0),
          uncertain: Boolean(r.uncertain) || !r.date_iso,
        }))
      );
      setNotice(
        "Lettura automatica completata: controlla e correggi date/conteggi prima di salvare, in particolare le righe evidenziate."
      );
    } catch {
      setError(
        "Lettura automatica non riuscita (errore di rete). Inserisci i dati manualmente."
      );
    } finally {
      setExtracting(false);
    }
  }

  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSuccessCount(null);
    setNotice(null);
    setError(null);

    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoBlob(null);
    setPhotoMimeType(null);
    setPhotoPreviewUrl(null);

    if (!file) return;

    try {
      const { blob, base64, mimeType } = await resizeImage(file);
      setPhotoBlob(blob);
      setPhotoMimeType(mimeType);
      setPhotoPreviewUrl(URL.createObjectURL(blob));
      await runExtraction(base64, mimeType);
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
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch, uncertain: false } : r))
    );
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  async function handleSave() {
    if (!supabase || !activeNodeId || !activeLevel || !photoBlob || !photoMimeType) return;

    const validRows = rows.filter((r) => r.date);
    if (validRows.length === 0) {
      setError("Aggiungi almeno una data con i conteggi (verifica le date evidenziate).");
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
        setRows([newRow()]);
        setNotice(null);
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
        Carica la foto del foglio cartaceo: i conteggi S/P per ogni data
        vengono letti automaticamente e proposti come bozza, da controllare e
        correggere prima di salvare. La foto non viene salvata da nessuna
        parte: resta solo sul dispositivo durante la revisione e sparisce
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
          Foto del foglio
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
        {extracting && (
          <p className="text-sm text-ink-soft">Lettura automatica in corso...</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Conteggi per data
          </h2>
          {photoBlob && photoMimeType && !extracting && (
            <button
              type="button"
              onClick={async () => {
                const base64 = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const result = reader.result as string;
                    resolve(result.split(",")[1] ?? "");
                  };
                  reader.onerror = () => reject(new Error("Lettura immagine fallita."));
                  reader.readAsDataURL(photoBlob);
                });
                runExtraction(base64, photoMimeType);
              }}
              className="text-xs text-ink-faint underline hover:text-ink-soft"
            >
              Rileggi foto
            </button>
          )}
        </div>

        {notice && <p className="text-xs text-amber-600">{notice}</p>}

        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className={`flex flex-wrap items-center gap-2 rounded-lg p-2 ${
                row.uncertain ? "bg-amber-100" : "bg-mint-100"
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <input
                  type="date"
                  value={row.date}
                  onChange={(e) => updateRow(row.key, { date: e.target.value })}
                  className="rounded-lg border border-line px-2 py-1 text-sm focus:border-mint-500 focus:outline-none"
                />
                {!row.date && row.dateLabel && (
                  <span className="text-[10px] text-amber-700">
                    scritto: &quot;{row.dateLabel}&quot; &mdash; verifica e completa
                  </span>
                )}
              </div>
              <label className="flex items-center gap-1 text-xs text-ink-soft">
                S
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={row.correct}
                  onChange={(e) => updateRow(row.key, { correct: e.target.value })}
                  className="w-16 rounded-lg border border-line px-2 py-1 text-sm text-correct focus:border-mint-500 focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-ink-soft">
                P
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={row.prompted}
                  onChange={(e) => updateRow(row.key, { prompted: e.target.value })}
                  className="w-16 rounded-lg border border-line px-2 py-1 text-sm text-prompted focus:border-mint-500 focus:outline-none"
                />
              </label>
              {row.uncertain && (
                <span className="text-[10px] font-semibold uppercase text-amber-700">
                  Verifica
                </span>
              )}
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                disabled={rows.length === 1}
                className="ml-auto text-xs text-ink-faint underline disabled:opacity-30"
              >
                Rimuovi
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="w-fit rounded-full border border-dashed border-line px-4 py-2 text-sm font-medium text-ink-faint hover:border-mint-200 hover:text-ink-soft"
          >
            + Aggiungi data
          </button>
        </div>
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
        disabled={saving || extracting || !activeNodeId || !photoBlob}
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
