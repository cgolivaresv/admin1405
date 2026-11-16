// ============================================================
//  Lectura de estados de cuenta CMR (PDF) dentro de la app.
//  Extrae el mes de facturación y el "Monto total facturado a pagar".
//  El PDF se procesa en el dispositivo; no se sube a ningún servidor.
// ============================================================
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Busca los datos en el texto ya extraído del PDF
export function extraerDatosCmr(texto) {
  const t = texto.replace(/\s+/g, " ");
  const f = t.match(/Fecha\s+Facturaci.n\s+Estado\s+de\s+Cuenta:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const m = t.match(/Monto\s+total\s+facturado\s+a\s+pagar\s+\$?\s*([\d.]+)/i);
  if (!f || !m) return null;
  const mm = f[2], yyyy = f[3];
  const total = Number(m[1].replace(/\./g, ""));
  if (!total && total !== 0) return null;
  return { periodo: `${yyyy}-${mm}`, mes: `${MESES[Number(mm) - 1]}-${yyyy}`, total };
}

// Abre el PDF (con clave si la tiene) y devuelve { periodo, mes, total }
export async function leerPdfCmr(pdfjsLib, data, password) {
  const doc = await pdfjsLib.getDocument({ data, password: password || undefined }).promise;
  let texto = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    texto += tc.items.map((it) => it.str).join(" ") + "\n";
  }
  return extraerDatosCmr(texto);
}
