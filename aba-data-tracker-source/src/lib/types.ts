export type Avatar = {
  id: number;
  name: string;
  emoji: string;
};

export type Child = {
  id: string;
  code: string;
  avatar_id: number | null;
  active: boolean;
};

export type NodeLevel = "objective" | "item" | "task";

// Catalogo globale e condiviso di obiettivi/item/task: non e' piu' legato a
// un singolo bambino, viene proposto come lista di scelta rapida e puo'
// crescere nel tempo tramite "Aggiungi Nuovo".
export type CatalogObjective = {
  id: string;
  nome: string;
  archived: boolean;
};

export type CatalogItem = {
  id: string;
  objective_id: string;
  nome: string;
  archived: boolean;
};

export type CatalogTask = {
  id: string;
  item_id: string;
  nome: string;
  archived: boolean;
};

export type TallyCount = {
  correct_count: number;
  prompted_count: number;
};

export type SessionInfo = {
  id: string;
  session_date: string;
  confirmed_at: string | null;
};

// Riga grezza della vista v_session_tally_detail: un conteggio salvato,
// gia' risolto al nome del nodo e al suo breadcrumb (obiettivo/item).
export type TallyDetailRow = {
  tally_id: string;
  session_id: string;
  child_id: string;
  session_date: string;
  confirmed_at: string | null;
  node_level: NodeLevel;
  node_id: string;
  correct_count: number;
  prompted_count: number;
  node_nome: string | null;
  objective_nome: string | null;
  item_nome: string | null;
};

// Un punto della serie storica di un nodo: i conteggi di UNA sessione.
export type NodeSessionPoint = {
  session_date: string;
  correct_count: number;
  prompted_count: number;
};

// Aggregazione per nodo (obiettivo/item/task) su un intervallo di sessioni:
// totali cumulativi + la serie per costruire l'andamento nel tempo.
export type NodeSummary = {
  node_level: NodeLevel;
  node_id: string;
  breadcrumb: string;
  total_correct: number;
  total_prompted: number;
  session_count: number;
  points: NodeSessionPoint[];
};
