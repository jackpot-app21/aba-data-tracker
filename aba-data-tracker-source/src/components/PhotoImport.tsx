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

// Foglio "mensile a date precompilate" (branch vision-locale, ambiente di
// test): il foglio cartaceo ha gia' le date stampate (Lun-Sab, tutto il
// mese), quindi la data non va piu' letta/indovinata ne' a mano ne' via AI:
// la deduciamo dalla posizione nella griglia una volta scelto il mese.
//
// Lettura automatica (riattivata): dopo aver scelto/scattato la foto, la
// mandiamo a /api/extract-tally (Claude vision, lato server, stessa rotta
// usata in produzione) che legge SOLO i conteggi S/P per ogni colonna di
// giorno gia' compilata (la data la leggiamo comunque dalla griglia, non ci
// fidiamo di quella restituita dal modello per il match: usiamo date_iso
// solo per abbinare la riga giusta). Il risultato precompila i campi S/P
// mostrati sotto come BOZZA MODIFICABILE: il tecnico la controlla e la
// corregge prima di salvare, non viene mai scritta direttamente a database.
// Le colonne segnalate "da controllare" (uncertain=true, o con una data che
// non trova corrispondenza nel mese scelto) restano evidenziate.
//
// IMPORTANTE: la foto NON viene mai salvata su database o storage. Viene
// inviata una sola volta all'endpoint per la lettura, resta in memoria nel
// browser come riferimento, e viene scartata appena si salvano i dati
// numerici. Questo riduce al minimo i dati sensibili conservati (sui fogli
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
  uncertain?: boolean;
  autoFilled?: boolean;
};

type ExtractedRow = {
  date_iso: string | null;
  date_label: string;
  correct_count: number;
  prompted_count: number;
  uncertain: boolean;
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

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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
  const [extracting, setExtracting] = useState(false);
  const [extractNotice, setExtractNotice] = useState<string | null>(null);

  const weekRows = useMemo(() => {
    const parsed = parseMonthValue(monthValue);
    if (!parsed) return [];
    return weekRowsForMonth(parsed.year, parsed.month);
  }, [monthValue]);

  useEffect(() => {
    setRows(buildRowsForMonth(monthValue));
    setSuccessCount(null);
    setExtractNotice(null);
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
    setExtractNotice(null);

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
      await runExtraction(blob, mimeType);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossibile elaborare la foto selezionata."
      );
    }
  }

  // Manda la foto a Claude vision (/api/extract-tally, stesso endpoint della
  // produzione) e precompila SOLO i conteggi S/P delle colonne che il
  // modello ha trovato compilate. La data che decide in quale riga della
  // griglia finisce il risultato resta sempre quella calcolata qui (dalla
  // posizione mese/giorno), non ci fidiamo di un eventuale errore di lettura
  // della data per lo "smistamento": usiamo date_iso del modello solo per
  // abbinare la colonna giusta tra quelle del mese selezionato.
  async function runExtraction(blob: Blob, mimeType: string) {
    setExtracting(true);
    setExtractNotice(null);
    try {
      const imageBase64 = await blobToBase64(blob);
      const res = await fetch("/api/extract-tally", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      const data = await res.json();

      if (!res.ok) {
        setExtractNotice(
          data?.error
            ? `Lettura automatica non riuscita: ${data.error} Puoi comunque compilare a mano.`
            : "Lettura automatica non riuscita. Puoi comunque compilare a mano."
        );
        return;
      }

      const extractedRows = (data?.rows ?? []) as ExtractedRow[];
      if (extractedRows.length === 0) {
        setExtractNotice(
          "Nessun segno trovato dalla lettura automatica (o foglio non riconosciuto). Controlla/compila a mano."
        );
        return;
      }

      let matched = 0;
      let unmatched = 0;
      setRows((prev) => {
        const byDate = new Map(prev.map((r) => [r.date, { ...r }]));
        for (const er of extractedRows) {
          if (!er.date_iso || !byDate.has(er.date_iso)) {
            unmatched += 1;
            continue;
          }
          const correctCount = er.correct_count ?? 0;
          const promptedCount = er.prompted_count ?? 0;
          // Rete di sicurezza: una colonna senza sessione non e' mai "0/0",
          // il prompt lo vieta esplicitamente, ma se il modello la include
          // comunque per errore NON dobbiamo precompilarla. Altrimenti
          // apparirebbe come un giorno "toccato" e rischierebbe di essere
          // salvata come sessione reale da 0 risposte se il tecnico non se
          // ne accorge prima di salvare (viola la regola "vuoto != zero").
          if (correctCount === 0 && promptedCount === 0) continue;
          matched += 1;
          byDate.set(er.date_iso, {
            ...byDate.get(er.date_iso)!,
            correct: String(correctCount),
            prompted: String(promptedCount),
            uncertain: Boolean(er.uncertain),
            autoFilled: true,
          });
        }
        return prev.map((r) => byDate.get(r.date) ?? r);
      });

      if (matched === 0) {
        setExtractNotice(
          "La lettura automatica ha trovato dei segni ma su date che non corrispondono al mese selezionato: controlla di aver scelto il mese giusto, oppure compila a mano."
        );
      } else {
        setExtractNotice(
          unmatched > 0
            ? `${matched} giorni letti automaticamente (${unmatched} scartati perche' fuori dal mese selezionato). Controlla i valori evidenziati in giallo prima di salvare.`
            : `${matched} giorni letti automaticamente. Controlla sempre i valori prima di salvare, specialmente quelli evidenziati in giallo.`
        );
      }
    } catch {
      setExtractNotice(
        "Lettura automatica non disponibile al momento. Puoi comunque compilare a mano."
      );
    } finally {
      setExtracting(false);
    }
  }

  function updateRow(key: string, patch: Partial<PhotoRow>) {
    setSuccessCount(null);
    // Una volta che il tecnico tocca a mano una cella, consideriamola
    // rivista: toglie l'evidenziazione "da controllare" anche se era stata
    // segnalata incerta dalla lettura automatica.
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, ...patch, uncertain: false } : r
      )
    );
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
        {extracting && (
          <p className="text-sm italic text-ink-soft">
            Lettura automatica in corso…
          </p>
        )}
        {!extracting && extractNotice && (
          <p className="text-xs text-ink-soft">{extractNotice}</p>
        )}
        {!extracting && photoBlob && photoMimeType && (
          <button
            type="button"
            onClick={() => runExtraction(photoBlob, photoMimeType)}
            className="w-fit rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-mint-200"
          >
            Rileggi foto
          </button>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Conteggi per data
        </h2>
        <p className="text-xs text-ink-faint">
          I valori precompilati dalla lettura automatica sono sempre una
          bozza: ricontrollali con la foto prima di salvare. Le celle gialle
          sono quelle che la lettura automatica segnala come incerte.
        </p>

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
                const cellClass = row.uncertain
                  ? "bg-amber-100 ring-1 ring-amber-400"
                  : touched
                    ? "bg-mint-100"
                    : "bg-line/10";
                return (
                  <div
                    key={day.date}
                    className={`flex flex-col items-center gap-1 rounded-md p-1.5 ${cellClass}`}
                  >
                    <span className="text-[10px] font-semibold text-ink-soft">
                      {day.dayName} {day.dayLabel}
                      {row.uncertain ? " ⚠" : ""}
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
