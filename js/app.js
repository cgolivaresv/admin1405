// ============================================================
//  Admin 1405 — hogar compartido
//  Firebase Auth (sesión persistente) + Firestore en tiempo real
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, deleteDoc, updateDoc, setDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  SIN_FECHA, fechaLocal, sumarDias, addMes, mesLabel,
  normId, CATEGORIAS, catPorPalabras,
  splidBalances, splidTransferencias, calcularPartes
} from "./logic.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// La sesión queda guardada en el dispositivo (no se pide clave en cada apertura)
setPersistence(auth, browserLocalPersistence);

// Versión de la app (mostrada al pie)
const APP_VERSION = "v1.8.0";
document.querySelectorAll("#app-footer, #login-version")
  .forEach((el) => { el.textContent = "Admin 1405 · " + APP_VERSION; });

// ---- Helpers DOM ----
const $ = (id) => document.getElementById(id);
const splash = $("splash"), loginEl = $("login"), appEl = $("app");

let user = null;
const unsubs = [];   // cancelar listeners al cerrar sesión

// ============================================================
//  AUTENTICACIÓN
// ============================================================
onAuthStateChanged(auth, (u) => {
  splash.classList.add("hidden");
  if (u) {
    user = u;
    loginEl.classList.add("hidden");
    appEl.classList.remove("hidden");
    $("who").textContent = u.displayName || u.email.split("@")[0];
    $("inicio-saludo").textContent = "Hola, " + (u.displayName || u.email.split("@")[0]);
    startListeners();
  } else {
    user = null;
    stopListeners();
    appEl.classList.add("hidden");
    loginEl.classList.remove("hidden");
  }
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("login-email").value.trim();
  const pass = $("login-pass").value;
  const btn = $("login-btn");
  $("login-error").textContent = "";
  btn.disabled = true; btn.textContent = "Entrando…";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    $("login-pass").value = "";
  } catch (err) {
    $("login-error").textContent = traducirError(err.code);
  } finally {
    btn.disabled = false; btn.textContent = "Entrar";
  }
});

$("logout-btn").addEventListener("click", () => {
  if (confirm("¿Cerrar sesión en este dispositivo?")) signOut(auth);
});

function traducirError(code) {
  const map = {
    "auth/invalid-email": "Correo inválido.",
    "auth/user-not-found": "No existe esa cuenta.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento.",
    "auth/network-request-failed": "Sin conexión."
  };
  return map[code] || "No se pudo entrar. Revisa los datos.";
}

// ============================================================
//  NAVEGACIÓN ENTRE SECCIONES
// ============================================================
const TABS = ["inicio", "cuentas", "compras", "notas", "splid"];
function switchTab(tab) {
  document.querySelectorAll(".tabbar-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  TABS.forEach((t) => $("tab-" + t).classList.toggle("hidden", t !== tab));
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabbar-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
// accesos rápidos desde Inicio (tarjetas y enlaces "Ver todo")
document.querySelectorAll("[data-goto]").forEach((el) => {
  el.addEventListener("click", () => switchTab(el.dataset.goto));
});

// ============================================================
//  LISTENERS EN TIEMPO REAL
// ============================================================
function startListeners() {
  stopListeners();
  unsubs.push(onSnapshot(query(collection(db, "cuentas"), orderBy("venc", "asc")), renderCuentas));
  unsubs.push(onSnapshot(query(collection(db, "compras"), orderBy("createdAt", "asc")), onCompras));
  unsubs.push(onSnapshot(collection(db, "productos"), onProductos));
  unsubs.push(onSnapshot(query(collection(db, "notas"), orderBy("createdAt", "desc")), renderNotas));
  unsubs.push(onSnapshot(query(collection(db, "cmr_gastos"), orderBy("periodo", "asc")), renderCmr));
  unsubs.push(onSnapshot(query(collection(db, "splid_personas"), orderBy("nombre", "asc")), onSpPersonas));
  unsubs.push(onSnapshot(query(collection(db, "splid_gastos"), orderBy("createdAt", "desc")), onSpGastos));
}
function stopListeners() {
  while (unsubs.length) unsubs.pop()();
}

const nombreCorto = () => (user?.displayName || user?.email?.split("@")[0] || "alguien");
const fmtMonto = (n) => (n || n === 0) ? "$" + Math.round(Number(n)).toLocaleString("es-CL") : "";
const fmtFecha = (d) => {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
};
// escape básico para texto de usuario en innerHTML
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

// Íconos SVG lineales (Home & Harmony), reutilizables en render
const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>';
const SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>';
const SVG_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';

// ============================================================
//  EDITOR GENÉRICO (modal para editar cualquier ítem)
//  campos: [{ id, label, type: text|number|date|month|checkbox|select, value, options }]
//  onSave(valores) puede devolver un texto de error para mostrarlo.
// ============================================================
let editorSave = null, editorDel = null;
function abrirEditor({ titulo, campos, onSave, onDelete }) {
  $("edit-title").textContent = titulo;
  $("edit-error").textContent = "";
  const box = $("edit-fields");
  box.innerHTML = "";
  campos.forEach((c) => {
    const lab = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = c.label;
    let inp;
    if (c.type === "select") {
      inp = document.createElement("select");
      c.options.forEach((o) => {
        const op = document.createElement("option");
        op.value = o; op.textContent = o;
        inp.appendChild(op);
      });
      inp.value = c.value ?? "";
    } else {
      inp = document.createElement("input");
      inp.type = c.type || "text";
      if (c.type === "checkbox") inp.checked = !!c.value;
      else inp.value = c.value ?? "";
      if (c.type === "number") { inp.min = "0"; inp.step = "1"; inp.inputMode = "numeric"; }
    }
    inp.dataset.campo = c.id;
    if (c.type === "checkbox") { lab.className = "check-inline"; lab.append(inp, span); }
    else { lab.className = "field"; lab.append(span, inp); }
    box.appendChild(lab);
  });
  editorSave = onSave;
  editorDel = onDelete || null;
  $("edit-del").classList.toggle("hidden", !onDelete);
  $("edit-modal").classList.remove("hidden");
}
function cerrarEditor() { $("edit-modal").classList.add("hidden"); editorSave = editorDel = null; }
$("edit-cancel").addEventListener("click", cerrarEditor);
$("edit-modal").addEventListener("click", (e) => { if (e.target.id === "edit-modal") cerrarEditor(); });
$("edit-save").addEventListener("click", async () => {
  if (!editorSave) return;
  const v = {};
  $("edit-fields").querySelectorAll("[data-campo]").forEach((i) => {
    v[i.dataset.campo] = i.type === "checkbox" ? i.checked : i.value.trim();
  });
  const error = await editorSave(v);
  if (error) $("edit-error").textContent = error;
  else cerrarEditor();
});
$("edit-del").addEventListener("click", async () => {
  if (!editorDel) return;
  if (await editorDel() !== false) cerrarEditor();
});

// ============================================================
//  GRÁFICO DE BARRAS (canvas) — usado por CMR y pagos anteriores
//  items: [{ label, total }]
// ============================================================
function drawBars(canvas, items) {
  if (!items.length) return;
  const max = Math.max(...items.map((r) => r.total)) || 1;
  const prom = items.reduce((a, r) => a + r.total, 0) / items.length;
  const dpr = window.devicePixelRatio || 1;
  const barW = 14, gap = 6, padL = 4, padR = 4, padTop = 14, padBot = 26;
  const h = 200;
  const w = Math.max(canvas.parentElement.clientWidth, padL + padR + items.length * (barW + gap));
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const chartH = h - padTop - padBot;
  const yFor = (v) => padTop + chartH * (1 - v / max);

  // línea de promedio
  ctx.strokeStyle = "#C98770";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padL, yFor(prom));
  ctx.lineTo(w - padR, yFor(prom));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "9px -apple-system, Arial, sans-serif";
  const cada = items.length > 12 ? 3 : 1;
  items.forEach((r, i) => {
    const x = padL + i * (barW + gap);
    const bh = chartH * (r.total / max);
    ctx.fillStyle = r.total === max ? "#B96F69" : "#667D68";
    ctx.fillRect(x, padTop + chartH - bh, barW, bh);
    if (i % cada === 0 || i === items.length - 1) {
      ctx.save();
      ctx.fillStyle = "#788078";
      ctx.translate(x + barW / 2, h - padBot + 4);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = "right";
      ctx.fillText(String(r.label).replace("-20", "-"), 0, 0);
      ctx.restore();
    }
  });
}
// Panel desplegable que redibuja su gráfico al abrirse
function panelDesplegable(toggleId, bodyId, alAbrir) {
  $(toggleId).addEventListener("click", () => {
    const abierto = $(bodyId).classList.toggle("hidden") === false;
    $(toggleId).setAttribute("aria-expanded", abierto ? "true" : "false");
    if (abierto) alAbrir();
  });
}

// ============================================================
//  SECCIÓN: CUENTAS
//  cuentas: { nombre, monto, venc, pagada, pagadaEn, recurrente, diaVenc, siguienteCreada }
// ============================================================
$("cuenta-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = $("cuenta-nombre").value.trim();
  if (!nombre) return;
  const monto = $("cuenta-monto").value ? Number($("cuenta-monto").value) : null;
  const fecha = $("cuenta-venc").value;
  const recurrente = $("cuenta-rec").checked;
  if (recurrente && !fecha) {
    alert("Para una cuenta mensual, indica la fecha de vencimiento.");
    return;
  }
  const venc = fecha || SIN_FECHA; // sin fecha = al final del orden
  e.target.reset();
  await addDoc(collection(db, "cuentas"), {
    nombre, monto, venc,
    pagada: false,
    recurrente,
    diaVenc: recurrente ? Number(fecha.split("-")[2]) : null,
    createdBy: nombreCorto(),
    createdAt: serverTimestamp()
  });
});

// Marcar pagada / pendiente. Una cuenta mensual genera la del mes siguiente al pagarse.
async function togglePagada(c) {
  const ref = doc(db, "cuentas", c.id);
  if (c.pagada) {
    await updateDoc(ref, { pagada: false, pagadaEn: null });
    return;
  }
  const cambios = { pagada: true, pagadaEn: fechaLocal() };
  const generar = c.recurrente && !c.siguienteCreada && c.venc && c.venc !== SIN_FECHA;
  if (generar) cambios.siguienteCreada = true;
  await updateDoc(ref, cambios);
  if (generar) {
    await addDoc(collection(db, "cuentas"), {
      nombre: c.nombre,
      monto: c.monto ?? null,
      venc: addMes(c.venc, c.diaVenc),
      pagada: false,
      recurrente: true,
      diaVenc: c.diaVenc || Number(c.venc.split("-")[2]),
      createdBy: c.createdBy || nombreCorto(),
      createdAt: serverTimestamp()
    });
  }
}

function editarCuenta(c) {
  abrirEditor({
    titulo: "Editar cuenta",
    campos: [
      { id: "nombre", label: "Nombre", value: c.nombre },
      { id: "monto", label: "Monto $", type: "number", value: c.monto ?? "" },
      { id: "venc", label: "Vencimiento", type: "date", value: c.venc === SIN_FECHA ? "" : c.venc },
      { id: "recurrente", label: "Se repite cada mes", type: "checkbox", value: c.recurrente }
    ],
    onSave: async (v) => {
      if (!v.nombre) return "Escribe un nombre.";
      if (v.recurrente && !v.venc) return "Una cuenta mensual necesita fecha de vencimiento.";
      await updateDoc(doc(db, "cuentas", c.id), {
        nombre: v.nombre,
        monto: v.monto === "" ? null : Number(v.monto),
        venc: v.venc || SIN_FECHA,
        recurrente: v.recurrente,
        diaVenc: v.recurrente ? Number(v.venc.split("-")[2]) : null
      });
    },
    onDelete: async () => {
      if (!confirm(`¿Eliminar "${c.nombre}"?`)) return false;
      await deleteDoc(doc(db, "cuentas", c.id));
    }
  });
}

function cuentaLi(c, hoy) {
  const li = document.createElement("li");
  li.className = "cuenta" + (c.pagada ? " pagada" : "");
  const conFecha = c.venc && c.venc !== SIN_FECHA;
  const vencida = !c.pagada && conFecha && c.venc < hoy;
  li.innerHTML = `
    <button class="cuenta-check" data-act="toggle" aria-label="Marcar pagada">${c.pagada ? SVG_CHECK : ""}</button>
    <div class="cuenta-body editable">
      <div class="cuenta-nombre"></div>
      <div class="cuenta-meta">
        ${conFecha ? `<span class="cuenta-venc ${vencida ? "vencida" : ""}">${SVG_CAL} ${fmtFecha(c.venc)}${vencida ? " ¡vencida!" : ""}</span>` : ""}
        ${c.recurrente ? `<span class="pill-mini">Mensual</span>` : ""}
        <span>· ${esc(c.createdBy || "")}</span>
      </div>
    </div>
    <span class="cuenta-monto">${fmtMonto(c.monto)}</span>
    <button class="cuenta-del" data-act="del" aria-label="Eliminar">${SVG_TRASH}</button>
  `;
  li.querySelector(".cuenta-nombre").textContent = c.nombre;
  li.querySelector('[data-act="toggle"]').onclick = () => togglePagada(c);
  li.querySelector(".cuenta-body").onclick = () => editarCuenta(c);
  li.querySelector('[data-act="del"]').onclick = () => {
    if (confirm(`¿Eliminar "${c.nombre}"?`)) deleteDoc(doc(db, "cuentas", c.id));
  };
  return li;
}

// Mes al que pertenece un pago (para el historial)
const mesDePago = (c) =>
  (c.pagadaEn || (c.venc && c.venc !== SIN_FECHA ? c.venc : "")).slice(0, 7);

let histItems = [];  // [{ label, total }] para el gráfico de pagos anteriores

function renderCuentas(snap) {
  const hoy = fechaLocal();
  const mesActual = hoy.slice(0, 7);
  const limite = sumarDias(hoy, 7);
  const list = $("cuentas-list");
  list.innerHTML = "";
  let totalPend = 0, cntPend = 0, visibles = 0;
  const pend = [], proximas = [], historial = {};

  snap.forEach((d) => {
    const c = { id: d.id, ...d.data() };
    const mes = mesDePago(c);
    // pagadas de meses anteriores → historial
    if (c.pagada && mes && mes !== mesActual) {
      (historial[mes] = historial[mes] || []).push(c);
      return;
    }
    if (!c.pagada) {
      cntPend++;
      if (c.monto) totalPend += Number(c.monto);
      const conFecha = c.venc && c.venc !== SIN_FECHA;
      const vencida = conFecha && c.venc < hoy;
      pend.push({ nombre: c.nombre, monto: c.monto, venc: c.venc, vencida });
      if (conFecha && c.venc <= limite) proximas.push({ nombre: c.nombre, monto: c.monto, venc: c.venc, vencida });
    }
    visibles++;
    list.appendChild(cuentaLi(c, hoy));
  });

  $("cuentas-empty").classList.toggle("hidden", visibles > 0);
  $("cuentas-resumen").textContent = cntPend
    ? `${cntPend} pendiente${cntPend > 1 ? "s" : ""} · ${fmtMonto(totalPend)}`
    : "Todo al día";

  // --- Pagos anteriores (agrupados por mes) ---
  const meses = Object.keys(historial).sort();
  $("hist-section").classList.toggle("hidden", meses.length === 0);
  const hl = $("hist-list");
  hl.innerHTML = "";
  histItems = meses.map((m) => ({
    label: mesLabel(m),
    total: historial[m].reduce((a, c) => a + (Number(c.monto) || 0), 0)
  }));
  [...meses].reverse().forEach((m, i) => {
    const total = histItems[meses.length - 1 - i].total;
    const head = document.createElement("li");
    head.className = "hist-mes";
    head.innerHTML = `<span>${mesLabel(m)}</span><span>${fmtMonto(total)}</span>`;
    hl.appendChild(head);
    historial[m].forEach((c) => hl.appendChild(cuentaLi(c, hoy)));
  });
  if (meses.length) {
    const totalHist = histItems.reduce((a, r) => a + r.total, 0);
    $("hist-resumen").textContent = `${meses.length} mes${meses.length > 1 ? "es" : ""} · ${fmtMonto(totalHist)}`;
    if (!$("hist-body").classList.contains("hidden")) drawBars($("hist-chart"), histItems);
  }

  // --- Inicio: vence pronto (vencidas o en los próximos 7 días) ---
  const iv = $("inicio-vence");
  iv.innerHTML = proximas.length
    ? proximas.slice(0, 4).map((p) =>
        `<div class="inicio-item"><span class="inicio-item__t">${esc(p.nombre)} <b class="venc">${p.vencida ? "vencida" : fmtFecha(p.venc)}</b></span><span class="inicio-item__v">${fmtMonto(p.monto)}</span></div>`
      ).join("")
    : `<p class="inicio-vacio">Nada vence en los próximos 7 días.</p>`;

  // --- Inicio: resumen de cuentas pendientes ---
  $("tile-cuentas").textContent = cntPend
    ? `${cntPend} pendiente${cntPend > 1 ? "s" : ""}` : "Al día";
  const ic = $("inicio-cuentas");
  if (!pend.length) {
    ic.innerHTML = `<p class="inicio-vacio">Todas las cuentas al día ✓</p>`;
  } else {
    ic.innerHTML =
      pend.slice(0, 3).map((p) =>
        `<div class="inicio-item"><span class="inicio-item__t">${esc(p.nombre)}${p.vencida ? ' <b class="venc">vencida</b>' : ""}</span><span class="inicio-item__v">${fmtMonto(p.monto)}</span></div>`
      ).join("") +
      `<div class="inicio-total"><span>Total pendiente</span><span>${fmtMonto(totalPend)}</span></div>`;
  }
}
panelDesplegable("hist-toggle", "hist-body", () => drawBars($("hist-chart"), histItems));

// ============================================================
//  SECCIÓN: SUPERMERCADO
//  compras:   { item, cant, categoria, comprado }
//  productos: { nombre, categoria }  ← memoria de productos para sugerir
// ============================================================
let comprasData = [];
let productos = {};   // normId → { nombre, categoria }

// selector de categoría del formulario ("" = automática)
(() => {
  const sel = $("compra-cat");
  const auto = document.createElement("option");
  auto.value = ""; auto.textContent = "Categoría: auto";
  sel.appendChild(auto);
  CATEGORIAS.forEach((c) => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
})();

// categoría recordada del producto, o sugerida por palabras clave
const categoriaAuto = (nombre) =>
  productos[normId(nombre)]?.categoria || catPorPalabras(nombre);

function onProductos(snap) {
  productos = {};
  const dl = $("productos-dl");
  dl.innerHTML = "";
  snap.forEach((d) => {
    const p = d.data();
    productos[d.id] = p;
    const o = document.createElement("option");
    o.value = p.nombre || d.id;
    dl.appendChild(o);
  });
}
function recordarProducto(nombre, categoria) {
  const id = normId(nombre);
  if (!id) return;
  setDoc(doc(db, "productos", id), { nombre, categoria }, { merge: true }).catch(() => {});
}

$("compra-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const item = $("compra-item").value.trim();
  if (!item) return;
  const cant = $("compra-cant").value.trim();
  const categoria = $("compra-cat").value || categoriaAuto(item);
  e.target.reset();
  $("compra-item").focus();
  recordarProducto(item, categoria);
  await addDoc(collection(db, "compras"), {
    item, cant: cant || null, categoria,
    comprado: false,
    createdBy: nombreCorto(),
    createdAt: serverTimestamp()
  });
});

$("limpiar-comprados").addEventListener("click", async () => {
  const comprados = comprasData.filter((c) => c.comprado);
  if (!comprados.length) return;
  if (!confirm(`¿Quitar ${comprados.length} producto(s) ya comprado(s)?`)) return;
  for (const c of comprados) await deleteDoc(doc(db, "compras", c.id));
});

function editarCompra(c) {
  abrirEditor({
    titulo: "Editar producto",
    campos: [
      { id: "item", label: "Producto", value: c.item },
      { id: "cant", label: "Cantidad", value: c.cant || "" },
      { id: "categoria", label: "Categoría", type: "select", options: CATEGORIAS,
        value: CATEGORIAS.includes(c.categoria) ? c.categoria : "Otros" }
    ],
    onSave: async (v) => {
      if (!v.item) return "Escribe el producto.";
      recordarProducto(v.item, v.categoria);
      await updateDoc(doc(db, "compras", c.id), {
        item: v.item, cant: v.cant || null, categoria: v.categoria
      });
    },
    onDelete: async () => { await deleteDoc(doc(db, "compras", c.id)); }
  });
}

function onCompras(snap) {
  comprasData = [];
  snap.forEach((d) => comprasData.push({ id: d.id, ...d.data() }));
  renderCompras();
}

function renderCompras() {
  const list = $("compras-list");
  list.innerHTML = "";
  const catDe = (c) => (CATEGORIAS.includes(c.categoria) ? c.categoria : "Otros");
  CATEGORIAS.forEach((cat) => {
    const items = comprasData.filter((c) => catDe(c) === cat);
    if (!items.length) return;
    const head = document.createElement("li");
    head.className = "cat-head";
    head.textContent = cat;
    list.appendChild(head);
    items.forEach((c) => {
      const li = document.createElement("li");
      li.className = "compra" + (c.comprado ? " comprado" : "");
      li.innerHTML = `
        <button class="compra-check" data-act="toggle" aria-label="Marcar comprado">${c.comprado ? SVG_CHECK : ""}</button>
        <span class="compra-text editable"></span>
        ${c.cant ? `<span class="compra-cant"></span>` : ""}
        <button class="cuenta-del" data-act="del" aria-label="Eliminar">${SVG_TRASH}</button>
      `;
      li.querySelector(".compra-text").textContent = c.item;
      if (c.cant) li.querySelector(".compra-cant").textContent = c.cant;
      li.querySelector('[data-act="toggle"]').onclick = () =>
        updateDoc(doc(db, "compras", c.id), { comprado: !c.comprado });
      li.querySelector(".compra-text").onclick = () => editarCompra(c);
      li.querySelector('[data-act="del"]').onclick = () => deleteDoc(doc(db, "compras", c.id));
      list.appendChild(li);
    });
  });
  $("compras-empty").classList.toggle("hidden", comprasData.length > 0);

  // --- Inicio: resumen de supermercado ---
  const porComprar = comprasData.filter((c) => !c.comprado).length;
  $("tile-compras").textContent = porComprar
    ? `${porComprar} por comprar` : "Lista al día";
}

// ============================================================
//  SECCIÓN: NOTAS
// ============================================================
const COLORES = ["#E9EFE7", "#F2ECE3", "#F6EAE4", "#E8EAE3", "#E4ECEC", "#EFEAF0"];
let notaEditId = null;
let notaColor = COLORES[0];

// pintar selector de colores
const colBox = $("nota-colores");
COLORES.forEach((c) => {
  const dot = document.createElement("button");
  dot.type = "button";
  dot.className = "color-dot";
  dot.style.background = c;
  dot.onclick = () => {
    notaColor = c;
    colBox.querySelectorAll(".color-dot").forEach((x) => x.classList.remove("sel"));
    dot.classList.add("sel");
  };
  colBox.appendChild(dot);
});

function abrirModal(nota = null) {
  notaEditId = nota?.id || null;
  notaColor = nota?.data?.color || COLORES[0];
  $("nota-modal-title").textContent = nota ? "Editar nota" : "Nueva nota";
  $("nota-titulo").value = nota?.data?.titulo || "";
  $("nota-contenido").value = nota?.data?.contenido || "";
  colBox.querySelectorAll(".color-dot").forEach((x, i) =>
    x.classList.toggle("sel", COLORES[i] === notaColor));
  $("nota-modal").classList.remove("hidden");
}
function cerrarModal() { $("nota-modal").classList.add("hidden"); }

$("nueva-nota").addEventListener("click", () => abrirModal());
$("nota-cancelar").addEventListener("click", cerrarModal);
$("nota-modal").addEventListener("click", (e) => { if (e.target.id === "nota-modal") cerrarModal(); });

$("nota-guardar").addEventListener("click", async () => {
  const titulo = $("nota-titulo").value.trim();
  const contenido = $("nota-contenido").value.trim();
  if (!titulo && !contenido) { cerrarModal(); return; }
  if (notaEditId) {
    await updateDoc(doc(db, "notas", notaEditId), { titulo, contenido, color: notaColor });
  } else {
    await addDoc(collection(db, "notas"), {
      titulo, contenido, color: notaColor,
      createdBy: nombreCorto(),
      createdAt: serverTimestamp()
    });
  }
  cerrarModal();
});

function renderNotas(snap) {
  const board = $("notas-board");
  board.innerHTML = "";
  const notas = [];
  snap.forEach((d) => {
    const n = d.data();
    notas.push(n);
    const el = document.createElement("div");
    el.className = "nota";
    el.style.background = n.color || COLORES[0];
    el.innerHTML = `
      <button class="nota-del" data-act="del" aria-label="Eliminar">${SVG_TRASH}</button>
      <div class="nota-titulo"></div>
      <div class="nota-contenido"></div>
      <div class="nota-meta"></div>
    `;
    el.querySelector(".nota-titulo").textContent = n.titulo || "";
    el.querySelector(".nota-contenido").textContent = n.contenido || "";
    el.querySelector(".nota-meta").textContent = "— " + (n.createdBy || "");
    el.querySelector('[data-act="del"]').onclick = (ev) => {
      ev.stopPropagation();
      if (confirm("¿Eliminar esta nota?")) deleteDoc(doc(db, "notas", d.id));
    };
    el.addEventListener("click", () => abrirModal({ id: d.id, data: n }));
    board.appendChild(el);
  });
  $("notas-empty").classList.toggle("hidden", snap.size > 0);

  // --- Inicio: últimas notas ---
  $("tile-notas").textContent = notas.length
    ? `${notas.length} nota${notas.length > 1 ? "s" : ""}` : "Sin notas";
  const inc = $("inicio-notas");
  if (!notas.length) {
    inc.innerHTML = `<p class="inicio-vacio">Aún no hay notas.</p>`;
  } else {
    inc.innerHTML = notas.slice(0, 2).map((n) => {
      const txt = n.titulo || n.contenido || "";
      return `<div class="inicio-nota" style="border-left-color:${esc(n.color || "#E9EFE7")}">
        <span class="inicio-nota__t">${esc(txt)}</span>
        <span class="inicio-nota__m">— ${esc(n.createdBy || "")}</span>
      </div>`;
    }).join("");
  }
}

// ============================================================
//  HISTORIAL CMR (datos privados en Firestore, no en el repo)
//  cmr_gastos/{YYYY-MM}: { periodo, mes, total }
// ============================================================
let cmrData = [];
const cmrItems = () => cmrData.map((r) => ({ label: r.mes || r.periodo, total: Number(r.total) || 0 }));

function guardarMesCmr(periodo, total) {
  return setDoc(doc(db, "cmr_gastos", periodo), { periodo, mes: mesLabel(periodo), total });
}

function editarMesCmr(r) {
  abrirEditor({
    titulo: r ? `CMR ${r.mes || r.periodo}` : "Agregar mes CMR",
    campos: [
      ...(r ? [] : [{ id: "periodo", label: "Mes del estado de cuenta", type: "month", value: fechaLocal().slice(0, 7) }]),
      { id: "total", label: "Monto total facturado $", type: "number", value: r ? r.total : "" }
    ],
    onSave: async (v) => {
      const periodo = r ? r.periodo : v.periodo;
      if (!/^\d{4}-\d{2}$/.test(periodo || "")) return "Elige el mes.";
      if (v.total === "" || Number(v.total) < 0) return "Ingresa el monto.";
      await guardarMesCmr(periodo, Number(v.total));
    },
    onDelete: r ? async () => {
      if (!confirm(`¿Eliminar ${r.mes || r.periodo} del historial?`)) return false;
      await deleteDoc(doc(db, "cmr_gastos", r.periodo));
    } : null
  });
}

function renderCmr(snap) {
  cmrData = [];
  snap.forEach((d) => cmrData.push(d.data()));
  const list = $("cmr-list");
  list.innerHTML = "";
  if (!cmrData.length) {
    $("cmr-resumen").textContent = "Sin datos";
    $("tile-cmr").textContent = "Sin datos";
    return;
  }
  const totales = cmrData.map((r) => Number(r.total) || 0);
  const prom = Math.round(totales.reduce((a, b) => a + b, 0) / totales.length);
  const max = Math.max(...totales), min = Math.min(...totales);

  $("cmr-resumen").textContent = `${cmrData.length} meses · prom ${fmtMonto(prom)}`;
  $("tile-cmr").textContent = `prom ${fmtMonto(prom)}`;

  [...cmrData].reverse().forEach((r) => {
    const li = document.createElement("li");
    li.className = "cmr-row editable" + (r.total === max ? " alto" : r.total === min ? " bajo" : "");
    li.innerHTML = `<span class="mes"></span><span class="val"></span>`;
    li.querySelector(".mes").textContent = r.mes || r.periodo;
    li.querySelector(".val").textContent = fmtMonto(r.total);
    li.onclick = () => editarMesCmr(r);
    list.appendChild(li);
  });

  // dibujar solo si el panel está abierto (el canvas necesita ancho visible)
  if (!$("cmr-body").classList.contains("hidden")) drawBars($("cmr-chart"), cmrItems());
}
panelDesplegable("cmr-toggle", "cmr-body", () => drawBars($("cmr-chart"), cmrItems()));
$("cmr-add").addEventListener("click", () => editarMesCmr(null));

// --- Importar un estado de cuenta en PDF (se lee en el dispositivo) ---
let pdfjsLib = null;
let cmrClave = "";   // solo en memoria, mientras la app esté abierta
$("cmr-import").addEventListener("click", () => $("cmr-file").click());
$("cmr-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const estado = $("cmr-status");
  estado.textContent = "Leyendo PDF…";
  try {
    if (!pdfjsLib) {
      pdfjsLib = await import("./vendor/pdf.min.mjs");
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
    }
    const { leerPdfCmr } = await import("./cmr-pdf.js");
    const buf = await file.arrayBuffer();
    let datos = null;
    for (let intento = 0; intento < 3; intento++) {
      try {
        datos = await leerPdfCmr(pdfjsLib, new Uint8Array(buf.slice(0)), cmrClave);
        break;
      } catch (err) {
        if (err?.name !== "PasswordException") throw err;
        const clave = prompt(intento === 0 && !cmrClave
          ? "Clave del PDF (tu RUT sin puntos ni dígito verificador):"
          : "Clave incorrecta. Inténtalo de nuevo:");
        if (clave === null) { estado.textContent = "Importación cancelada."; return; }
        cmrClave = clave.trim();
      }
    }
    if (!datos) { estado.textContent = "No pude leer el monto en este PDF. Usa \"Agregar mes\"."; return; }
    if (!confirm(`${datos.mes}: ${fmtMonto(datos.total)}\n¿Guardar en el historial?`)) {
      estado.textContent = "No se guardó.";
      return;
    }
    await guardarMesCmr(datos.periodo, datos.total);
    estado.textContent = `Guardado: ${datos.mes} · ${fmtMonto(datos.total)}`;
  } catch (err) {
    estado.textContent = "No se pudo leer el PDF. Usa \"Agregar mes\" para ingresarlo a mano.";
  }
});

// ============================================================
//  SPLID — dividir gastos
//  splid_personas: { nombre }
//  splid_gastos:   { titulo, monto, pagadoPor, para:[nombres], partes:{nombre:monto}|null, tipo:"gasto"|"pago" }
// ============================================================
let spPersonas = [], spGastos = [];
function onSpPersonas(snap) {
  spPersonas = [];
  snap.forEach((d) => spPersonas.push({ id: d.id, ...d.data() }));
  renderSplid();
}
function onSpGastos(snap) {
  spGastos = [];
  snap.forEach((d) => spGastos.push({ id: d.id, ...d.data() }));
  renderSplid();
}

// nombres = personas registradas + cualquiera que aparezca en un gasto
function splidNombres() {
  const set = new Set(spPersonas.map((p) => p.nombre));
  spGastos.forEach((g) => {
    if (g.pagadoPor) set.add(g.pagadoPor);
    (g.para || []).forEach((n) => set.add(n));
  });
  return [...set];
}

function renderSplid() {
  // --- personas ---
  const pBox = $("splid-personas");
  pBox.innerHTML = "";
  spPersonas.forEach((p) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<span></span><button class="chip-x" type="button" aria-label="Quitar">×</button>`;
    chip.querySelector("span").textContent = p.nombre;
    chip.querySelector(".chip-x").onclick = () => {
      if (confirm(`¿Quitar a "${p.nombre}"? Sus gastos ya registrados se mantienen.`))
        deleteDoc(doc(db, "splid_personas", p.id));
    };
    pBox.appendChild(chip);
  });

  // --- saldos ---
  const bal = splidBalances(splidNombres(), spGastos);
  const nombres = Object.keys(bal);
  const sBox = $("splid-saldos");
  if (!nombres.length) {
    sBox.innerHTML = `<p class="inicio-vacio">Agrega a las personas para empezar.</p>`;
  } else {
    sBox.innerHTML = nombres.map((n) => {
      const v = Math.round(bal[n]);
      const cls = v > 0 ? "saldo-pos" : v < 0 ? "saldo-neg" : "";
      const txt = v > 0 ? `le deben ${fmtMonto(v)}` : v < 0 ? `debe ${fmtMonto(-v)}` : "al día";
      return `<div class="inicio-item"><span class="inicio-item__t">${esc(n)}</span><span class="inicio-item__v ${cls}">${txt}</span></div>`;
    }).join("");
  }

  // --- total gastado (sin contar pagos entre personas) ---
  const total = spGastos.filter((g) => g.tipo !== "pago")
    .reduce((a, g) => a + (Number(g.monto) || 0), 0);
  $("splid-total").textContent = total ? `Total ${fmtMonto(total)}` : "";

  // --- para saldar ---
  const trs = splidTransferencias(bal);
  const tBox = $("splid-saldar");
  tBox.innerHTML = "";
  if (!trs.length) {
    tBox.innerHTML = `<p class="inicio-vacio">Todo saldado ✓</p>`;
  } else {
    trs.forEach((t) => {
      const row = document.createElement("div");
      row.className = "saldar-row";
      row.innerHTML = `<span class="txt"><b>${esc(t.de)}</b> paga a <b>${esc(t.a)}</b> ${fmtMonto(t.monto)}</span>
        <button class="saldar-btn" type="button">Saldar</button>`;
      row.querySelector(".saldar-btn").onclick = () => {
        if (!confirm(`¿Registrar que ${t.de} pagó ${fmtMonto(t.monto)} a ${t.a}?`)) return;
        addDoc(collection(db, "splid_gastos"), {
          titulo: "Pago", monto: t.monto, pagadoPor: t.de, para: [t.a], partes: null, tipo: "pago",
          createdBy: nombreCorto(), createdAt: serverTimestamp()
        });
      };
      tBox.appendChild(row);
    });
  }

  // --- Inicio: acceso a Splid con el saldo ---
  const yo = nombres.find((n) => n.toLowerCase() === nombreCorto().toLowerCase());
  let hint;
  if (!nombres.length) hint = "Sin configurar";
  else if (!trs.length) hint = "Todo saldado";
  else if (yo) {
    const v = Math.round(bal[yo]);
    hint = v > 0 ? `Te deben ${fmtMonto(v)}` : v < 0 ? `Debes ${fmtMonto(-v)}` : "Estás al día";
  } else hint = `${trs[0].de} debe ${fmtMonto(trs[0].monto)} a ${trs[0].a}`;
  $("tile-splid").textContent = hint;

  // --- movimientos ---
  const list = $("splid-gastos");
  list.innerHTML = "";
  spGastos.forEach((g) => {
    const esPago = g.tipo === "pago";
    const li = document.createElement("li");
    li.className = "cuenta" + (esPago ? " gasto-pago" : "");
    const fecha = g.createdAt && g.createdAt.toDate
      ? g.createdAt.toDate().toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" }) : "";
    li.innerHTML = `
      <div class="cuenta-body ${esPago ? "" : "editable"}">
        <div class="cuenta-nombre"></div>
        <div class="cuenta-meta"><span class="quien"></span>${fecha ? `<span>· ${fecha}</span>` : ""}</div>
      </div>
      <span class="cuenta-monto">${fmtMonto(g.monto)}</span>
      <button class="cuenta-del" data-act="del" aria-label="Eliminar">${SVG_TRASH}</button>
    `;
    li.querySelector(".cuenta-nombre").textContent = g.titulo || (esPago ? "Pago" : "Gasto");
    const entre = (g.para || []).map((n) => g.partes ? `${n} (${fmtMonto(g.partes[n] || 0)})` : n).join(", ");
    li.querySelector(".quien").textContent = esPago
      ? `${g.pagadoPor} → ${(g.para || []).join(", ")}`
      : `Pagó ${g.pagadoPor} · entre ${entre}`;
    if (!esPago) li.querySelector(".cuenta-body").onclick = () => abrirSplidModal(g);
    li.querySelector('[data-act="del"]').onclick = () => {
      if (confirm("¿Eliminar este movimiento?")) deleteDoc(doc(db, "splid_gastos", g.id));
    };
    list.appendChild(li);
  });
  $("splid-empty").classList.toggle("hidden", spGastos.length > 0);
}

// agregar persona
$("splid-persona-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = $("splid-persona").value.trim();
  if (!nombre) return;
  const existe = spPersonas.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase());
  e.target.reset();
  if (existe) return;
  await addDoc(collection(db, "splid_personas"), { nombre, createdAt: serverTimestamp() });
});

// --- modal de gasto (nuevo o edición), con división igual, por montos o por % ---
let splidEditId = null;
let splidPara = new Set();
let splidModo = "iguales";
let splidVals = {};      // nombre → valor escrito (monto o %)
let splidOrden = [];     // nombres en el orden mostrado

function pintarSplidPartes() {
  document.querySelectorAll("#splid-modo .chip").forEach((b) =>
    b.classList.toggle("sel", b.dataset.modo === splidModo));
  const box = $("splid-partes");
  box.innerHTML = "";
  if (splidModo === "iguales") return;
  splidOrden.filter((n) => splidPara.has(n)).forEach((n) => {
    const row = document.createElement("label");
    row.className = "parte-row";
    const span = document.createElement("span");
    span.textContent = n;
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = "0"; inp.inputMode = "decimal";
    inp.placeholder = splidModo === "montos" ? "$" : "%";
    inp.value = splidVals[n] ?? "";
    inp.oninput = () => { splidVals[n] = inp.value; };
    row.append(span, inp);
    box.appendChild(row);
  });
}
document.querySelectorAll("#splid-modo .chip").forEach((b) => {
  b.addEventListener("click", () => {
    if (splidModo !== b.dataset.modo) splidVals = {};
    splidModo = b.dataset.modo;
    pintarSplidPartes();
  });
});

function abrirSplidModal(g = null) {
  // al editar, incluye también a quienes figuren en el gasto aunque ya no estén en la lista
  const set = new Set(spPersonas.map((p) => p.nombre));
  if (g) { set.add(g.pagadoPor); (g.para || []).forEach((n) => set.add(n)); }
  splidOrden = [...set];
  if (splidOrden.length < 2) { alert("Agrega al menos dos personas para dividir gastos."); return; }

  splidEditId = g ? g.id : null;
  $("splid-modal-title").textContent = g ? "Editar gasto" : "Nuevo gasto";
  $("splid-titulo").value = g ? (g.titulo || "") : "";
  $("splid-monto").value = g ? g.monto : "";
  $("splid-error").textContent = "";

  const sel = $("splid-pagador");
  sel.innerHTML = "";
  const yo = nombreCorto().toLowerCase();
  splidOrden.forEach((n) => {
    const o = document.createElement("option");
    o.value = n; o.textContent = n;
    if (g ? n === g.pagadoPor : n.toLowerCase() === yo) o.selected = true;
    sel.appendChild(o);
  });

  splidPara = new Set(g ? (g.para || []) : splidOrden);
  splidModo = g && g.partes ? "montos" : "iguales";
  splidVals = g && g.partes ? { ...g.partes } : {};

  const box = $("splid-para");
  box.innerHTML = "";
  splidOrden.forEach((n) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip toggle" + (splidPara.has(n) ? " sel" : "");
    b.textContent = n;
    b.onclick = () => {
      if (splidPara.has(n)) splidPara.delete(n); else splidPara.add(n);
      b.classList.toggle("sel", splidPara.has(n));
      pintarSplidPartes();
    };
    box.appendChild(b);
  });
  pintarSplidPartes();
  $("splid-modal").classList.remove("hidden");
}
function cerrarSplidModal() { $("splid-modal").classList.add("hidden"); }

$("splid-nuevo").addEventListener("click", () => abrirSplidModal());
$("splid-cancelar").addEventListener("click", cerrarSplidModal);
$("splid-modal").addEventListener("click", (e) => { if (e.target.id === "splid-modal") cerrarSplidModal(); });
$("splid-guardar").addEventListener("click", async () => {
  const titulo = $("splid-titulo").value.trim();
  const monto = Number($("splid-monto").value);
  const pagadoPor = $("splid-pagador").value;
  const para = splidOrden.filter((n) => splidPara.has(n));
  const err = (t) => { $("splid-error").textContent = t; };
  if (!titulo) return err("Escribe en qué se gastó.");
  if (!monto || monto <= 0) return err("Ingresa un monto válido.");
  if (!para.length) return err("Elige entre quiénes se divide.");
  const r = calcularPartes(splidModo, monto, para, splidVals);
  if (r.error) return err(r.error);
  cerrarSplidModal();
  const datos = { titulo, monto, pagadoPor, para, partes: r.partes, tipo: "gasto" };
  if (splidEditId) {
    await updateDoc(doc(db, "splid_gastos", splidEditId), datos);
  } else {
    await addDoc(collection(db, "splid_gastos"), {
      ...datos, createdBy: nombreCorto(), createdAt: serverTimestamp()
    });
  }
});

// ============================================================
//  SERVICE WORKER (PWA)
// ============================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js").catch(() => {}));
}
