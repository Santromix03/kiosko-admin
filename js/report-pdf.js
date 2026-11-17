const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm';

const MARGIN = 14;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 22;

const COLUMNS = [
  { width: 44, align: 'left' },
  { width: 28, align: 'right' },
  { width: 42, align: 'right' },
  { width: 42, align: 'right' },
  { width: 26, align: 'right' },
];
const HEADERS = ['Fecha', 'Pedidos', 'Ingresos', 'Ticket prom.', 'Ítems'];

const int = n => Number(n ?? 0).toLocaleString('es-CO');
const money = n => '$' + Math.round(Number(n ?? 0)).toLocaleString('es-CO');
const parseIso = value => {
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const fmtLong = iso => parseIso(iso).toLocaleDateString('es-CO', {
  day: 'numeric', month: 'long', year: 'numeric',
});
const fmtShort = iso => parseIso(iso).toLocaleDateString('es-CO', {
  day: '2-digit', month: '2-digit', year: 'numeric',
});

function setText(doc, size, style, color) {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}

function heading(doc, text, y) {
  setText(doc, 12, 'bold', [36, 20, 14]);
  doc.text(text, MARGIN, y);
  doc.setDrawColor(232, 220, 210);
  doc.line(MARGIN, y + 3, PAGE_W - MARGIN, y + 3);
  return y + 9;
}

function drawCells(doc, y, values, { head = false, total = false, zebra = false } = {}) {
  const height = head ? 8 : 7.2;

  if (head) doc.setFillColor(168, 28, 33);
  else if (total) doc.setFillColor(253, 242, 242);
  else if (zebra) doc.setFillColor(250, 247, 242);
  else doc.setFillColor(255, 255, 255);
  doc.rect(MARGIN, y, CONTENT_W, height, 'F');

  if (total) {
    doc.setDrawColor(168, 28, 33);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  }

  if (head) setText(doc, 8.5, 'bold', [255, 255, 255]);
  else if (total) setText(doc, 8.5, 'bold', [110, 14, 18]);
  else setText(doc, 8.5, 'normal', [36, 20, 14]);

  let x = MARGIN;
  values.forEach((value, i) => {
    const col = COLUMNS[i];
    const tx = col.align === 'right' ? x + col.width - 2 : x + 2;
    doc.text(String(value), tx, y + (head ? 5.4 : 4.9), { align: col.align });
    x += col.width;
  });

  doc.setDrawColor(238, 228, 218);
  doc.line(MARGIN, y + height, MARGIN + CONTENT_W, y + height);
  return y + height;
}

function newPage(doc) {
  doc.addPage();
  setText(doc, 10, 'bold', [126, 102, 88]);
  doc.text('Kiosko - Informe de ventas (continuación)', MARGIN, 16);
  doc.setDrawColor(232, 220, 210);
  doc.line(MARGIN, 18.5, PAGE_W - MARGIN, 18.5);
  return 26;
}

export async function downloadSalesReport({ from, to, points }) {
  const { jsPDF } = await import(JSPDF_URL);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const sorted = [...(points ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const salesDays = sorted.filter(p => Number(p.orders) > 0);
  const totalRevenue = sorted.reduce((sum, p) => sum + Number(p.revenue ?? 0), 0);
  const totalOrders = sorted.reduce((sum, p) => sum + Number(p.orders ?? 0), 0);
  const totalItems = sorted.reduce((sum, p) => sum + Number(p.items ?? 0), 0);
  const avgTicket = totalOrders ? totalRevenue / totalOrders : 0;
  const avgDaily = sorted.length ? totalRevenue / sorted.length : 0;
  const avgSalesDay = salesDays.length ? totalRevenue / salesDays.length : 0;
  const noSalesDays = sorted.length - salesDays.length;
  const best = salesDays.reduce(
    (a, b) => (a == null || Number(b.revenue) > Number(a.revenue) ? b : a),
    null,
  );

  // Encabezado
  doc.setFillColor(168, 28, 33);
  doc.rect(0, 0, PAGE_W, 34, 'F');
  doc.setFillColor(110, 14, 18);
  doc.rect(0, 34, PAGE_W, 1.5, 'F');

  setText(doc, 18, 'bold', [255, 255, 255]);
  doc.text('Kiosko - Informe de ventas', MARGIN, 16);

  setText(doc, 9.5, 'normal', [253, 242, 242]);
  doc.text(`Periodo: ${fmtLong(from)} al ${fmtLong(to)}`, MARGIN, 24);

  setText(doc, 8, 'normal', [238, 220, 200]);
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, PAGE_W - MARGIN, 15, { align: 'right' });
  doc.text('Panel de administración', PAGE_W - MARGIN, 21, { align: 'right' });

  // Resumen
  let y = heading(doc, 'Resumen del periodo', 44);

  const boxGap = 4;
  const boxW = (CONTENT_W - boxGap * 3) / 4;
  const boxH = 22;
  const kpis = [
    { label: 'INGRESOS', value: money(totalRevenue) },
    { label: 'PEDIDOS', value: int(totalOrders) },
    { label: 'TICKET PROMEDIO', value: money(avgTicket) },
    { label: 'ÍTEMS VENDIDOS', value: int(totalItems) },
  ];

  kpis.forEach((kpi, i) => {
    const x = MARGIN + i * (boxW + boxGap);
    doc.setFillColor(250, 247, 242);
    doc.setDrawColor(232, 220, 210);
    doc.roundedRect(x, y, boxW, boxH, 2, 2, 'FD');

    setText(doc, 7, 'bold', [126, 102, 88]);
    doc.text(kpi.label, x + 3, y + 7);

    setText(doc, 13, 'bold', [36, 20, 14]);
    doc.text(kpi.value, x + 3, y + 16);
  });
  y += boxH + 8;

  setText(doc, 9, 'normal', [74, 51, 40]);
  const lines = [
    `Días del periodo: ${int(sorted.length)}   |   Días con ventas: ${int(salesDays.length)}   |   Días sin ventas: ${int(noSalesDays)}`,
    best
      ? `Mejor día: ${fmtLong(best.date)} - ${money(best.revenue)} (${int(best.orders)} pedidos)`
      : 'Mejor día: sin ventas en el periodo',
    `Promedio diario: ${money(avgDaily)}   |   Promedio por día con ventas: ${money(avgSalesDay)}`,
  ];
  lines.forEach(line => {
    doc.text(line, MARGIN, y);
    y += 5.5;
  });
  y += 4;

  // Detalle diario
  y = heading(doc, 'Detalle de días con ventas', y);

  if (salesDays.length) {
    y = drawCells(doc, y, HEADERS, { head: true });

    let zebra = false;
    for (const day of salesDays) {
      if (y + 7.2 > BOTTOM) {
        y = newPage(doc);
        y = drawCells(doc, y, HEADERS, { head: true });
      }

      y = drawCells(doc, y, [
        fmtShort(day.date),
        int(day.orders),
        money(day.revenue),
        money(day.orders ? Number(day.revenue) / Number(day.orders) : 0),
        int(day.items),
      ], { zebra });

      zebra = !zebra;
    }

    if (y + 8 > BOTTOM) {
      y = newPage(doc);
      y = drawCells(doc, y, HEADERS, { head: true });
    }

    y = drawCells(doc, y, [
      'TOTAL',
      int(totalOrders),
      money(totalRevenue),
      money(avgTicket),
      int(totalItems),
    ], { total: true });

    if (y + 12 > BOTTOM) y = newPage(doc);
    setText(doc, 7.5, 'normal', [126, 102, 88]);
    doc.text('Solo se listan los días que tuvieron pedidos.', MARGIN, y + 6);
  } else {
    setText(doc, 9.5, 'normal', [126, 102, 88]);
    doc.text('No se registraron ventas en el periodo seleccionado.', MARGIN, y + 2);
  }

  // Pie de página
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(232, 220, 210);
    doc.line(MARGIN, PAGE_H - 14, PAGE_W - MARGIN, PAGE_H - 14);
    setText(doc, 7.5, 'normal', [126, 102, 88]);
    doc.text('Kiosko Admin - Informe generado automáticamente', MARGIN, PAGE_H - 8);
    doc.text(`Página ${i} de ${pages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
  }

  const fileName = `informe-ventas_${from}_a_${to}.pdf`;
  doc.save(fileName);
  return { pages, fileName };
}
