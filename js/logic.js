// ============================================================
//  Lógica pura de Admin 1405 (sin DOM ni Firebase), para poder probarla.
// ============================================================
export const SIN_FECHA = "9999-12-31";
export const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const pad = (n) => String(n).padStart(2, "0");

// Fecha local (no UTC) como YYYY-MM-DD
export function fechaLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function sumarDias(str, n) {
  const [y, m, d] = str.split("-").map(Number);
  return fechaLocal(new Date(y, m - 1, d + n));
}
// Mismo día del mes siguiente; si el mes es más corto, usa su último día.
// `dia` permite conservar el día original (31 → 28 feb → 31 mar).
export function addMes(str, dia) {
  const [y, m, d] = str.split("-").map(Number);
  let ny = y, nm = m + 1;
  if (nm > 12) { nm = 1; ny++; }
  const ultimo = new Date(ny, nm, 0).getDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(dia || d, ultimo))}`;
}
// "2026-11" → "nov-2026"
export function mesLabel(key) {
  const [y, m] = key.split("-");
  return `${MESES[Number(m) - 1] || m}-${y}`;
}

// ---------- Supermercado ----------
export const sinAcentos = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function normId(s) {
  return sinAcentos(s).trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
export const CATEGORIAS = [
  "Frutas y verduras", "Lácteos y huevos", "Carnes y pescados", "Panadería",
  "Despensa", "Bebidas", "Congelados", "Limpieza", "Higiene", "Otros"
];
const PALABRAS = {
  "Frutas y verduras": ["manzana", "platano", "tomate", "lechuga", "cebolla", "papa", "papas", "zanahoria", "palta", "limon", "fruta", "verdura", "naranja", "pimenton", "ajo", "zapallo", "pepino", "frutilla", "uva", "cilantro", "choclo"],
  "Lácteos y huevos": ["leche", "queso", "yogur", "yoghurt", "mantequilla", "huevo", "huevos", "crema", "quesillo", "margarina"],
  "Carnes y pescados": ["pollo", "carne", "vacuno", "cerdo", "pescado", "jamon", "salchicha", "pavo", "longaniza", "salmon", "atun", "chuleta", "hamburguesa"],
  "Panadería": ["pan", "hallulla", "marraqueta", "tortilla", "queque", "molde"],
  "Despensa": ["arroz", "fideos", "fideo", "tallarines", "aceite", "azucar", "sal", "harina", "cafe", "te", "lentejas", "porotos", "salsa", "cereal", "avena", "mermelada", "galletas", "mayonesa", "ketchup", "vinagre", "pasta"],
  "Bebidas": ["bebida", "jugo", "agua", "cerveza", "vino", "gaseosa"],
  "Congelados": ["congelado", "congelada", "helado", "hielo"],
  "Limpieza": ["detergente", "cloro", "lavaloza", "esponja", "limpiador", "suavizante", "basura", "lustramuebles", "desinfectante"],
  "Higiene": ["shampoo", "jabon", "desodorante", "higienico", "toalla", "panales", "dientes", "dental", "acondicionador", "confort"]
};
// Categoría sugerida por palabras clave (coincidencia de palabra completa)
export function catPorPalabras(nombre) {
  const palabras = sinAcentos(nombre).split(/[^a-z0-9]+/).filter(Boolean);
  for (const cat of Object.keys(PALABRAS)) {
    if (palabras.some((p) => PALABRAS[cat].includes(p))) return cat;
  }
  return "Otros";
}

// ---------- Splid ----------
// saldo > 0: le deben · saldo < 0: debe
export function splidBalances(nombres, gastos) {
  const bal = {};
  nombres.forEach((n) => { bal[n] = 0; });
  const suma = (n, v) => { bal[n] = (bal[n] || 0) + v; };
  gastos.forEach((g) => {
    const m = Number(g.monto) || 0;
    const para = g.para || [];
    if (!m || !para.length || !g.pagadoPor) return;
    suma(g.pagadoPor, m);
    if (g.partes) {
      para.forEach((n) => suma(n, -(Number(g.partes[n]) || 0)));
    } else {
      para.forEach((n) => suma(n, -m / para.length));
    }
  });
  return bal;
}
// Transferencias mínimas: los que deben pagan a los que les deben
export function splidTransferencias(bal) {
  const deb = [], cre = [];
  Object.keys(bal).forEach((n) => {
    const v = Math.round(bal[n]);
    if (v < 0) deb.push({ n, v: -v });
    else if (v > 0) cre.push({ n, v });
  });
  deb.sort((a, b) => b.v - a.v);
  cre.sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < deb.length && j < cre.length) {
    const x = Math.min(deb[i].v, cre[j].v);
    if (x > 0) out.push({ de: deb[i].n, a: cre[j].n, monto: x });
    deb[i].v -= x; cre[j].v -= x;
    if (!deb[i].v) i++;
    if (!cre[j].v) j++;
  }
  return out;
}
// Calcula las partes según el modo. Devuelve { partes } o { error }.
// modo "iguales" → partes null (se divide parejo al calcular saldos).
export function calcularPartes(modo, monto, para, vals) {
  if (modo === "iguales") return { partes: null };
  const nums = para.map((n) => Number(vals[n]) || 0);
  if (nums.some((v) => v < 0)) return { error: "No puede haber valores negativos." };
  const suma = nums.reduce((a, b) => a + b, 0);
  const partes = {};
  if (modo === "montos") {
    if (Math.abs(suma - monto) >= 1)
      return { error: `Los montos suman ${Math.round(suma).toLocaleString("es-CL")} y deben sumar ${Math.round(monto).toLocaleString("es-CL")}.` };
    para.forEach((n, i) => { partes[n] = nums[i]; });
  } else {
    if (Math.abs(suma - 100) > 0.01)
      return { error: `Los porcentajes suman ${suma} y deben sumar 100.` };
    para.forEach((n, i) => { partes[n] = monto * nums[i] / 100; });
  }
  return { partes };
}
