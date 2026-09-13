// Griglia Lun-Sab per un mese: stessa logica (stessi giorni, stesso
// raggruppamento a blocchi settimanali) usata per generare il foglio
// cartaceo con le date gia' stampate. Serve a precompilare le date nella
// maschera di importazione foto, cosi' la data non va piu' letta (a mano o
// via AI) ma e' sempre nota in anticipo dalla posizione nella griglia.
export type MonthlyGridDay = {
  date: string; // YYYY-MM-DD
  dayName: string; // "Lun".."Sab"
  dayLabel: string; // "05/10"
  inMonth: boolean;
};

export type MonthlyWeekRow = MonthlyGridDay[]; // sempre 6 elementi, Lun..Sab

const DAY_NAMES = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// month: 1-12 (convenzione "umana", non l'indice 0-based di Date)
export function weekRowsForMonth(year: number, month: number): MonthlyWeekRow[] {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0));

  // 0 = lunedi ... 6 = domenica
  const firstDow = (firstDay.getUTCDay() + 6) % 7;
  const firstMonday = new Date(firstDay);
  firstMonday.setUTCDate(firstDay.getUTCDate() - firstDow);

  const rows: MonthlyWeekRow[] = [];
  const cursor = new Date(firstMonday);

  while (cursor <= lastDay) {
    const row: MonthlyGridDay[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(cursor);
      d.setUTCDate(cursor.getUTCDate() + i);
      const inMonth = d.getUTCMonth() === month - 1;
      row.push({
        date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
        dayName: DAY_NAMES[i],
        dayLabel: `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`,
        inMonth,
      });
    }
    rows.push(row);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return rows;
}

// Parsa il valore di un <input type="month"> ("YYYY-MM") in {year, month}.
export function parseMonthValue(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}
