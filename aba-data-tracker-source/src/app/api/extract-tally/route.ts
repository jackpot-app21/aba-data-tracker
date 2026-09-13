import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

// Endpoint server-side (Scenario B): riceve la foto del foglio cartaceo e
// usa Claude (vision) per contare automaticamente le stanghette S/P per ogni
// colonna/data. La chiave API resta solo qui lato server, mai esposta al
// browser del tecnico ABA. Il risultato viene sempre mostrato in app come
// bozza modificabile, mai salvato direttamente.
//
// Questo endpoint e' il percorso usato in produzione (TALLY_PROVIDER assente
// o "anthropic"). Il branch vision-locale usa invece una pipeline di
// computer vision interamente client-side (nessuna chiamata a questo
// endpoint): il provider "google" (Gemini via Google AI Studio, usato solo
// per test gratuiti su dati non clinici) e' stato rimosso, non serve piu' ne'
// in produzione ne' come alternativa di test.
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `Sei un assistente che legge fogli cartacei di raccolta dati ABA (Applied Behavior Analysis) fotografati da un tecnico.

Il foglio ha questa struttura:
- Un titolo in alto (obiettivo/item), da IGNORARE.
- Un riferimento al periodo in alto a destra, da IGNORARE (spesso non aggiornato).
- Una o piu' colonne, una per ogni data di sessione. Ogni colonna ha 3 righe: "S" (in alto), "P" (in mezzo), "%" (in basso, da IGNORARE sempre).
- Le righe S e P contengono segni a mano: stanghette verticali raggruppate in blocchi da 5 (4 stanghette verticali + 1 barra orizzontale che le attraversa = quel gruppo vale 5). Un gruppo incompleto (es. 3 stanghette verticali senza barra) vale il numero di stanghette visibili.

Il tuo compito: per OGNI colonna/data visibile nella foto, conta con la massima precisione possibile il numero totale di segni nella riga S e nella riga P (somma di tutti i gruppi da 5 piu' eventuali segni sciolti), e leggi la data scritta a mano sopra o sotto la colonna.

Per la data: se riesci a dedurre con certezza giorno, mese e anno (l'anno puo' essere assente sul foglio ma dedotto dal contesto, es. altre date vicine o l'anno corrente), restituisci date_iso in formato YYYY-MM-DD. Se hai un dubbio ragionevole su qualsiasi parte della data, lascia date_iso a null e riporta comunque in date_label il testo esatto cosi' come scritto a mano.

Segnala uncertain=true per qualsiasi colonna in cui i segni sono sbavati, sovrapposti, poco leggibili, o la data non e' chiara. E' MEGLIO segnalare incertezza che indovinare: chi userà questi dati li rivedra' sempre a mano prima di salvarli.

Rispondi SOLO usando lo strumento extract_tally_rows, con una voce per ogni colonna individuata, da sinistra a destra.`;

const EXTRACTION_INSTRUCTION =
  "Leggi questo foglio cartaceo ed estrai i conteggi S/P per ogni colonna/data.";

type ExtractedRow = {
  date_iso: string | null;
  date_label: string;
  correct_count: number;
  prompted_count: number;
  uncertain: boolean;
};

type AllowedMimeType = "image/jpeg" | "image/png" | "image/webp";

const TALLY_TOOL: Anthropic.Tool = {
  name: "extract_tally_rows",
  description:
    "Registra i conteggi S/P estratti dal foglio cartaceo, una voce per ogni colonna/data individuata.",
  input_schema: {
    type: "object",
    properties: {
      rows: {
        type: "array",
        description:
          "Una voce per ogni colonna di data leggibile sul foglio, da sinistra a destra.",
        items: {
          type: "object",
          properties: {
            date_iso: {
              type: ["string", "null"],
              description:
                "Data della colonna in formato ISO YYYY-MM-DD, solo se leggibile con certezza (anno incluso). Altrimenti null.",
            },
            date_label: {
              type: "string",
              description:
                "Testo della data cosi' come scritto a mano sul foglio (es. '12/04'), usato quando date_iso e' null.",
            },
            correct_count: {
              type: "integer",
              description:
                "Numero totale di stanghette nella riga S (risposte spontanee).",
            },
            prompted_count: {
              type: "integer",
              description:
                "Numero totale di stanghette nella riga P (risposte promptate).",
            },
            uncertain: {
              type: "boolean",
              description:
                "true se la lettura di questa colonna (data e/o conteggi) e' incerta.",
            },
          },
          required: [
            "date_iso",
            "date_label",
            "correct_count",
            "prompted_count",
            "uncertain",
          ],
        },
      },
    },
    required: ["rows"],
  },
};

async function extractWithAnthropic(
  apiKey: string,
  imageBase64: string,
  mimeType: AllowedMimeType
): Promise<ExtractedRow[]> {
  // Alcune chiavi API generate su platform.claude.com sono "identity-linked"
  // (legate a un workspace, o a "tutti i workspace") e l'API rifiuta la
  // richiesta senza sapere in quale workspace agire. ANTHROPIC_WORKSPACE_ID
  // e' opzionale: se la chiave e' di questo tipo, va impostata anche questa
  // variabile d'ambiente (id del workspace, non un segreto) altrimenti la
  // chiamata fallisce con "anthropic-workspace-id is required...".
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const anthropic = new Anthropic({
    apiKey,
    defaultHeaders: workspaceId
      ? { "anthropic-workspace-id": workspaceId }
      : undefined,
  });

  const message = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [TALLY_TOOL],
    tool_choice: { type: "tool", name: "extract_tally_rows" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: EXTRACTION_INSTRUCTION,
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolUse) {
    throw new Error("Lettura automatica non riuscita (nessun risultato dal modello).");
  }

  const input = toolUse.input as { rows?: ExtractedRow[] };
  return input.rows ?? [];
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json(
      {
        error:
          "Lettura automatica non configurata (manca la chiave API sul server). Inserisci i dati manualmente.",
      },
      { status: 501 }
    );
  }

  let body: { imageBase64?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Richiesta non valida." }, { status: 400 });
  }

  const { imageBase64, mimeType } = body;
  if (!imageBase64 || !mimeType) {
    return Response.json({ error: "Immagine mancante." }, { status: 400 });
  }

  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
  if (!allowedMimeTypes.includes(mimeType as (typeof allowedMimeTypes)[number])) {
    return Response.json(
      { error: "Formato immagine non supportato." },
      { status: 400 }
    );
  }
  const safeMimeType = mimeType as AllowedMimeType;

  try {
    const rows = await extractWithAnthropic(apiKey, imageBase64, safeMimeType);

    return Response.json({ rows });
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Errore lettura automatica: ${err.message}`
            : "Errore imprevisto durante la lettura automatica.",
      },
      { status: 500 }
    );
  }
}
