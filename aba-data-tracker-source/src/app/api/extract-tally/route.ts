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
// Sonnet legge i dettagli fini (colonne strette, stanghette ravvicinate o
// scritte in corsivo) in modo piu' affidabile di Haiku. La differenza di
// costo per foto e' minima (un'unica immagine compressa per chiamata, pochi
// millesimi di dollaro), quindi conviene usarlo qui.
const ANTHROPIC_MODEL = "claude-sonnet-5-5";

const SYSTEM_PROMPT = `Sei un assistente che legge fogli cartacei mensili di raccolta dati ABA (Applied Behavior Analysis) fotografati da un tecnico.

Il foglio ha questa struttura:
- Intestazione in alto (bambino/obiettivo/item/task), da IGNORARE.
- 4 quadrati neri pieni agli angoli del foglio (marker di riferimento), da IGNORARE come contenuto.
- 5 blocchi settimanali impilati, ciascuno con 6 colonne di giorno (Lun-Sab) con la DATA GIA' STAMPATA sopra ogni colonna (es. "Lun 05/10"). Alcune colonne, quelle di giorni fuori dal mese, hanno sfondo grigio: IGNORALE sempre, anche se contengono segni.
- Ogni blocco ha 2 righe di dati sotto la data: "S" (risposte spontanee) e "P" (risposte promptate). Non esiste una riga "%".
- Le stanghette possono essere scritte con penna di QUALSIASI colore (nera, blu, verde, rossa, o altro): considera "inchiostro" qualunque tratto scritto a mano che si distingue dallo sfondo bianco/grigio del foglio, indipendentemente dal colore. Non ignorare ne' sottostimare segni solo perche' non sono neri.
- IMPORTANTE - notazione dei conteggi: ogni stanghetta verticale ( | ) rappresenta UNA risposta. Per il numero 5 sono VALIDE entrambe le notazioni, anche miste nello stesso foglio: (a) 5 stanghette verticali singole una accanto all'altra, oppure (b) il tally tradizionale a 4 stanghette verticali + 1 barra orizzontale/diagonale che le attraversa tutte e 4 (quel gruppo vale 5). Riconosci entrambe le forme. Un gruppo di 4 stanghette SENZA barra vale 4, non 5. Un gruppo incompleto (es. 3 stanghette singole) vale il numero di stanghette visibili. Conta sempre il totale corretto di risposte in ciascuna cella, sommando eventuali piu' gruppi da 5 (in qualunque delle due notazioni) piu' i segni sciolti.
- Una colonna (giorno) senza alcun segno in S e P significa che quel giorno NON c'e' stata sessione: NON e' uno zero. Questa regola e' VINCOLANTE: se non vedi inchiostro vero (nemmeno un tratto dubbio) in NESSUNA delle due righe di quella colonna, quella colonna NON VA MAI inclusa nel risultato, nemmeno con conteggio 0, nemmeno segnalata come incerta. Includi una colonna SOLO se c'e' inchiostro reale in almeno una delle due righe.

- IMPORTANTE - assegnazione colonna: ogni blocco settimanale ha linee verticali nere stampate che separano una colonna di giorno dall'altra. Prima di assegnare un segno a una colonna, verifica che il segno si trovi per intero nello spazio bianco tra le due linee verticali di quella colonna, non in quella immediatamente a sinistra o a destra: i segni scritti a mano spesso pendono o sconfinano leggermente verso la colonna vicina, e lo spazio tra colonne e' stretto, quindi e' facile attribuire un gruppo di stanghette alla data sbagliata. Controlla colonna per colonna, da sinistra a destra, che il numero di colonne con segni e le rispettive date stampate sopra corrispondano esattamente a quello che vedi, prima di finalizzare la risposta.

Il tuo compito: per OGNI colonna di giorno che appartiene al mese (sfondo bianco) E che ha almeno un segno in S o in P, conta con la massima precisione possibile il numero di stanghette nella riga S e nella riga P, e riporta la data esatta gia' stampata sopra quella colonna (non c'e' bisogno di leggere una data scritta a mano: usa quella stampata).

Per la data: restituisci sempre date_iso in formato YYYY-MM-DD, leggendo il numero del mese e il "Mese AAAA" scritto nel titolo del foglio (es. "Ottobre 2026") insieme al giorno stampato sopra la colonna. Se per qualche motivo il titolo con mese/anno non è leggibile, lascia date_iso a null e riporta in date_label il testo del giorno cosi' come stampato (es. "Lun 05/10").

Segnala uncertain=true per qualsiasi colonna in cui i segni sono sbavati, sovrapposti, poco leggibili, scritti in corsivo/collegati tra loro senza spazi netti, o ambigui nel conteggio o nell'assegnazione alla colonna giusta. E' MEGLIO segnalare incertezza che indovinare: chi userà questi dati li rivedra' sempre a mano prima di salvarli.

Rispondi SOLO usando lo strumento extract_tally_rows, con una voce per ogni colonna di giorno compilata (con segni), da sinistra a destra, saltando le colonne vuote o fuori mese.`;

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
  // ANTHROPIC_API_KEY2 e' il nome usato per la chiave dell'ambiente di
  // test (vision-locale) quando ANTHROPIC_API_KEY e' gia' occupato su
  // Vercel dalla chiave di produzione. Si legge prima la variabile
  // "standard" e, se assente, quella alternativa: cosi' basta impostare
  // UNA sola delle due per ambiente, senza doverle rinominare su Vercel.
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY2;

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
