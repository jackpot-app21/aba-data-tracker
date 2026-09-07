# ABA Data Tracker

App per velocizzare e automatizzare la presa dati durante le sessioni di terapia ABA.

## Stack

- **Next.js 14** (App Router) + TypeScript + Tailwind CSS
- **Supabase** — database Postgres, autenticazione, storage foto
- **Vercel** — hosting e deploy continuo da questa repo
- **Claude API (Anthropic)** — lettura automatica delle stanghette dalle foto (Scenario B)

## Struttura dati (schema Supabase)

- `children` — bambini, identificati solo da un **codice pseudonimo + avatar**, nessun dato anagrafico
- `catalog_objectives` / `catalog_items` / `catalog_tasks` — catalogo **globale e condiviso** di Obiettivo → Item (opz.) → Task (opz.), proposto come lista di scelta rapida nell'app e ampliabile con "Aggiungi Nuovo"
- `sessions` — una sessione di terapia per un bambino, in una data, con `confirmed_at` valorizzato quando la terapista preme "Salva sessione" e `source` (`manual` / `photo_import`) che indica come sono stati inseriti i dati
- `session_tallies` — conteggi S (+, spontanee) / P (-, promptate) per ogni nodo (obiettivo/item/task) toccato in una sessione
- `photo_imports` — tabella storica (non più scritta): le foto dei fogli cartacei **non vengono più conservate**, quindi non si creano nuove righe qui. Resta solo per compatibilità con eventuali dati passati.
- `v_session_tally_detail` — vista con ogni conteggio già risolto al nome del nodo e al suo breadcrumb (obiettivo/item), usata dal report "Andamento"

## Storage

- Le foto dei fogli cartacei **non vengono salvate**: vengono usate solo in memoria sul dispositivo per la lettura automatica e l'anteprima, poi scartate una volta confermati i dati numerici. Questo tiene lo spazio occupato vicino a zero e riduce al minimo i dati sensibili conservati.
- Il bucket privato `session-photos` (se presente) resta inutilizzato dalla versione corrente dell'app.

## Variabili d'ambiente

Vedi `.env.example`. `ANTHROPIC_API_KEY` è opzionale: senza di essa lo Scenario B funziona comunque, ma senza lettura automatica (l'endpoint restituisce un errore gestito e l'inserimento resta manuale).

## Sviluppo locale

```bash
npm install
cp .env.example .env.local   # inserisci URL, anon key Supabase e (opzionale) chiave Anthropic
npm run dev
```

## Deploy

Ogni push sul branch `main` viene automaticamente pubblicato su Vercel.
