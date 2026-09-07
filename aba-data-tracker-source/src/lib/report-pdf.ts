import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { NodeSessionPoint, NodeSummary } from "./types";

const S_COLOR = "#0b8f76";
const P_COLOR = "#e2483f";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Genera e avvia il download di un PDF riassuntivo del report di un
// bambino: pensato per essere condiviso con genitori o altri specialisti,
// quindi niente dati anagrafici (solo il codice pseudonimo passato come
// childLabel). Include la tabella dei totali e, per ogni obiettivo/item/
// task, il grafico dell'andamento S/P nel tempo (disegnato su un canvas
// nascosto e incorporato come immagine, dato che i PDF non sanno renderizzare SVG).
export async function buildChildReportPdf({
  childLabel,
  fromDate,
  toDate,
  summaries,
}: {
  childLabel: string;
  fromDate: string;
  toDate: string;
  summaries: NodeSummary[];
}) {
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("ABA Data Tracker — Report andamento", MARGIN, 18);

  doc.setFontSize(11);
  doc.text(`Bambino: ${childLabel}`, MARGIN, 28);

  const rangeLabel =
    fromDate || toDate
      ? `Periodo: ${fromDate ? formatDateIt(fromDate) : "inizio"} - ${
          toDate ? formatDateIt(toDate) : "oggi"
        }`
      : "Periodo: tutto lo storico";
  doc.text(rangeLabel, MARGIN, 35);

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `Generato il ${formatDateIt(new Date().toISOString().slice(0, 10))}`,
    MARGIN,
    41
  );
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 48,
    head: [
      ["Obiettivo / Item / Task", "Sessioni", "S (spontanee)", "P (prompt)", "% spontanee"],
    ],
    body: summaries.map((s) => {
      const total = s.total_correct + s.total_prompted;
      const percent =
        total > 0 ? `${Math.round((s.total_correct / total) * 100)}%` : "-";
      return [
        s.breadcrumb,
        String(s.session_count),
        String(s.total_correct),
        String(s.total_prompted),
        percent,
      ];
    }),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: { 0: { cellWidth: 90 } },
  });

  // jspdf-autotable espone la Y raggiunta dopo l'ultima tabella su
  // doc.lastAutoTable.finalY (tipizzazione non ufficiale, da qui il cast).
  let cursorY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? 48;
  cursorY += 10;

  if (summaries.length > 0) {
    cursorY = drawLegend(doc, cursorY);
  }

  const CHART_W = CONTENT_WIDTH;
  const CHART_H = (CHART_W * 220) / 520; // stessa proporzione del canvas
  const TITLE_H = 6;
  const BLOCK_GAP = 8;
  const BLOCK_H = TITLE_H + CHART_H + BLOCK_GAP;

  for (const summary of summaries) {
    if (cursorY + BLOCK_H > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
      cursorY = MARGIN;
    }

    const total = summary.total_correct + summary.total_prompted;
    const percent =
      total > 0 ? `${Math.round((summary.total_correct / total) * 100)}%` : "-";

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(summary.breadcrumb, MARGIN, cursorY + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(
      `S: ${summary.total_correct}  ·  P: ${summary.total_prompted}  ·  ${percent} spontanee`,
      MARGIN + CONTENT_WIDTH,
      cursorY + 4,
      { align: "right" }
    );
    doc.setTextColor(0);

    const png = renderTrendChartPng(summary.points);
    doc.addImage(png, "PNG", MARGIN, cursorY + TITLE_H, CHART_W, CHART_H);

    cursorY += BLOCK_H;
  }

  doc.save(`report-${sanitizeFileName(childLabel)}.pdf`);
}

function drawLegend(doc: jsPDF, y: number): number {
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.setDrawColor(11, 143, 118);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, MARGIN + 6, y);
  doc.text("S (spontanee) — linea continua", MARGIN + 8, y + 1);

  doc.setDrawColor(226, 72, 63);
  doc.setLineDashPattern([1.2, 1], 0);
  doc.line(MARGIN + 70, y, MARGIN + 76, y);
  doc.setLineDashPattern([], 0);
  doc.text("P (promptate) — linea tratteggiata", MARGIN + 78, y + 1);

  doc.setTextColor(0);
  return y + 6;
}

// Disegna il grafico S/P su un canvas HTML nascosto e lo restituisce come
// PNG data URL, pronto per doc.addImage. Ricalca lo stesso layout del
// grafico mostrato nell'app (TrendChart in ReportView.tsx).
function renderTrendChartPng(points: NodeSessionPoint[]): string {
  const scale = 3; // canvas piu' grande del necessario per restare nitido nel PDF
  const width = 520;
  const height = 220;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const padLeft = 40;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 56;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxValue = Math.max(
    1,
    ...points.flatMap((p) => [p.correct_count, p.prompted_count])
  );
  const yMax = niceCeiling(maxValue);
  const yTicks = [0, Math.round(yMax / 2), yMax];

  function xAt(i: number) {
    return points.length > 1
      ? padLeft + (i * plotW) / (points.length - 1)
      : padLeft + plotW / 2;
  }
  function yAt(v: number) {
    return padTop + plotH - (v / yMax) * plotH;
  }

  // gridlines + etichette Y
  ctx.strokeStyle = "#e2e8f0";
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  yTicks.forEach((t) => {
    const y = yAt(t);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();
    ctx.fillText(String(t), padLeft - 6, y);
  });

  // etichette X (date, ruotate)
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  points.forEach((p, i) => {
    const x = xAt(i);
    const y = height - padBottom + 14;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((-40 * Math.PI) / 180);
    ctx.fillText(formatDateShort(p.session_date), 0, 0);
    ctx.restore();
  });

  if (points.length > 1) {
    // linea S continua
    ctx.strokeStyle = S_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.correct_count);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // linea P tratteggiata
    ctx.strokeStyle = P_COLOR;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.prompted_count);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // marcatori: cerchio verde per S, quadrato rosso per P (forma diversa dal
  // colore, cosi' restano distinguibili anche senza vedere i colori)
  points.forEach((p, i) => {
    const x = xAt(i);

    const ySpont = yAt(p.correct_count);
    ctx.beginPath();
    ctx.fillStyle = S_COLOR;
    ctx.arc(x, ySpont, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    const yProm = yAt(p.prompted_count);
    ctx.fillStyle = P_COLOR;
    ctx.fillRect(x - 3, yProm - 3, 6, 6);
    ctx.strokeStyle = "#ffffff";
    ctx.strokeRect(x - 3, yProm - 3, 6, 6);
  });

  return canvas.toDataURL("image/png");
}

function niceCeiling(value: number): number {
  if (value <= 5) return 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  let niceNormalized: number;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

function formatDateShort(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatDateIt(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function sanitizeFileName(label: string): string {
  return label.replace(/[^a-zA-Z0-9-_]+/g, "_");
}
