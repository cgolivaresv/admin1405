// ============================================================
//  Admin 1405 — diario mural compartido
//  Firebase Auth (sesión persistente) + Firestore en tiempo real
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, deleteDoc, updateDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// La sesión queda guardada en el dispositivo (no se pide clave en cada apertura)
setPersistence(auth, browserLocalPersistence);

// Versión de la app (mostrada al pie)
const APP_VERSION = "v1.5.0";
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
document.querySelectorAll(".tabbar-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tabbar-btn").forEach((b) => b.classList.toggle("active", b === btn));
    ["cuentas", "compras", "notas"].forEach((t) => {
      $("tab-" + t).classList.toggle("hidden", t !== tab);
    });
    window.scrollTo(0, 0);
  });
});

// ============================================================
//  LISTENERS EN TIEMPO REAL
// ============================================================
function startListeners() {
  stopListeners();
  unsubs.push(onSnapshot(query(collection(db, "cuentas"), orderBy("venc", "asc")), renderCuentas));
  unsubs.push(onSnapshot(query(collection(db, "compras"), orderBy("createdAt", "asc")), renderCompras));
  unsubs.push(onSnapshot(query(collection(db, "notas"), orderBy("createdAt", "desc")), renderNotas));
  unsubs.push(onSnapshot(query(collection(db, "cmr_gastos"), orderBy("periodo", "asc")), renderCmr));
}
function stopListeners() {
  while (unsubs.length) unsubs.pop()();
}

const nombreCorto = () => (user?.displayName || user?.email?.split("@")[0] || "alguien");
const fmtMonto = (n) => (n || n === 0) ? "$" + Number(n).toLocaleString("es-CL") : "";
const fmtFecha = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}`;
};

// Íconos SVG lineales (Home & Harmony), reutilizables en render
const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>';
const SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>';
const SVG_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';

// ============================================================
//  SECCIÓN: CUENTAS
// ============================================================
$("cuenta-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = $("cuenta-nombre").value.trim();
  if (!nombre) return;
  const monto = $("cuenta-monto").value ? Number($("cuenta-monto").value) : null;
  const venc = $("cuenta-venc").value || "9999-12-31"; // sin fecha = al final del orden
  await addDoc(collection(db, "cuentas"), {
    nombre, monto, venc,
    pagada: false,
    createdBy: nombreCorto(),
    createdAt: serverTimestamp()
  });
  e.target.reset();
});

function renderCuentas(snap) {
  const list = $("cuentas-list");
  list.innerHTML = "";
  let totalPend = 0, cntPend = 0;
  const hoy = new Date().toISOString().slice(0, 10);

  snap.forEach((d) => {
    const c = d.data();
    if (!c.pagada && c.monto) { totalPend += Number(c.monto); }
    if (!c.pagada) cntPend++;

    const li = document.createElement("li");
    li.className = "cuenta" + (c.pagada ? " pagada" : "");
    const vencida = !c.pagada && c.venc && c.venc !== "9999-12-31" && c.venc < hoy;
    li.innerHTML = `
      <button class="cuenta-check" data-act="toggle">${c.pagada ? SVG_CHECK : ""}</button>
      <div class="cuenta-body">
        <div class="cuenta-nombre"></div>
        <div class="cuenta-meta">
          ${c.venc && c.venc !== "9999-12-31" ? `<span class="cuenta-venc ${vencida ? "vencida" : ""}">${SVG_CAL} ${fmtFecha(c.venc)}${vencida ? " ¡vencida!" : ""}</span>` : ""}
          <span>· ${c.createdBy || ""}</span>
        </div>
      </div>
      <span class="cuenta-monto">${fmtMonto(c.monto)}</span>
      <button class="cuenta-del" data-act="del" aria-label="Eliminar">${SVG_TRASH}</button>
    `;
    li.querySelector(".cuenta-nombre").textContent = c.nombre;
    li.querySelector('[data-act="toggle"]').onclick = () =>
      updateDoc(doc(db, "cuentas", d.id), { pagada: !c.pagada });
    li.querySelector('[data-act="del"]').onclick = () => {
      if (confirm(`¿Eliminar "${c.nombre}"?`)) deleteDoc(doc(db, "cuentas", d.id));
    };
    list.appendChild(li);
  });

  $("cuentas-empty").classList.toggle("hidden", snap.size > 0);
  $("cuentas-resumen").textContent = cntPend
    ? `${cntPend} pendiente${cntPend > 1 ? "s" : ""} · ${fmtMonto(totalPend)}`
    : "Todo al día ✓";
}

// ============================================================
//  SECCIÓN: SUPERMERCADO
// ============================================================
$("compra-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const item = $("compra-item").value.trim();
  if (!item) return;
  const cant = $("compra-cant").value.trim();
  await addDoc(collection(db, "compras"), {
    item, cant: cant || null,
    comprado: false,
    createdBy: nombreCorto(),
    createdAt: serverTimestamp()
  });
  e.target.reset();
  $("compra-item").focus();
});

$("limpiar-comprados").addEventListener("click", async () => {
  const comprados = window.__compras?.filter((x) => x.data.comprado) || [];
  if (!comprados.length) return;
  if (!confirm(`¿Quitar ${comprados.length} producto(s) ya comprado(s)?`)) return;
  for (const x of comprados) await deleteDoc(doc(db, "compras", x.id));
});

function renderCompras(snap) {
  const list = $("compras-list");
  list.innerHTML = "";
  window.__compras = [];
  snap.forEach((d) => {
    const c = d.data();
    window.__compras.push({ id: d.id, data: c });
    const li = document.createElement("li");
    li.className = "compra" + (c.comprado ? " comprado" : "");
    li.innerHTML = `
      <button class="compra-check" data-act="toggle">${c.comprado ? SVG_CHECK : ""}</button>
      <span class="compra-text"></span>
      ${c.cant ? `<span class="compra-cant"></span>` : ""}
      <button class="cuenta-del" data-act="del" aria-label="Eliminar">${SVG_TRASH}</button>
    `;
    li.querySelector(".compra-text").textContent = c.item;
    if (c.cant) li.querySelector(".compra-cant").textContent = c.cant;
    li.querySelector('[data-act="toggle"]').onclick = () =>
      updateDoc(doc(db, "compras", d.id), { comprado: !c.comprado });
    li.querySelector('[data-act="del"]').onclick = () => deleteDoc(doc(db, "compras", d.id));
    list.appendChild(li);
  });
  $("compras-empty").classList.toggle("hidden", snap.size > 0);
}

// ============================================================
//  SECCIÓN: NOTAS / DIARIO MURAL
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
  snap.forEach((d) => {
    const n = d.data();
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
}

// ============================================================
//  HISTORIAL CMR (lee de Firestore; datos privados, no en el repo)
// ============================================================
let cmrState = null;

function renderCmr(snap) {
  const sec = $("cmr-section");
  const data = [];
  snap.forEach((d) => data.push(d.data()));
  if (!data.length) { sec.classList.add("hidden"); return; }
  sec.classList.remove("hidden");

  const totales = data.map((r) => Number(r.total) || 0);
  const prom = Math.round(totales.reduce((a, b) => a + b, 0) / totales.length);
  const max = Math.max(...totales), min = Math.min(...totales);
  cmrState = { data, prom, max, min };

  $("cmr-resumen").textContent = `${data.length} meses · prom ${fmtMonto(prom)}`;

  // --- lista mensual ---
  const list = $("cmr-list");
  list.innerHTML = "";
  [...data].reverse().forEach((r) => {
    const li = document.createElement("li");
    li.className = "cmr-row" + (r.total === max ? " alto" : r.total === min ? " bajo" : "");
    li.innerHTML = `<span class="mes"></span><span class="val"></span>`;
    li.querySelector(".mes").textContent = r.mes || r.periodo;
    li.querySelector(".val").textContent = fmtMonto(r.total);
    list.appendChild(li);
  });

  // dibujar solo si el panel está abierto (el canvas necesita ancho visible)
  if (!$("cmr-body").classList.contains("hidden")) {
    drawCmrChart(data, max, prom);
  }
}

// desplegar / plegar el historial
$("cmr-toggle").addEventListener("click", () => {
  const body = $("cmr-body");
  const abierto = body.classList.toggle("hidden") === false;
  $("cmr-toggle").setAttribute("aria-expanded", abierto ? "true" : "false");
  if (abierto && cmrState) drawCmrChart(cmrState.data, cmrState.max, cmrState.prom);
});

function drawCmrChart(data, max, prom) {
  const canvas = $("cmr-chart");
  const dpr = window.devicePixelRatio || 1;
  const barW = 14, gap = 6, padL = 4, padR = 4, padTop = 14, padBot = 26;
  const h = 200;
  const w = Math.max(canvas.parentElement.clientWidth, padL + padR + data.length * (barW + gap));
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
  ctx.textAlign = "center";
  data.forEach((r, i) => {
    const x = padL + i * (barW + gap);
    const bh = chartH * (r.total / max);
    const y = padTop + chartH - bh;
    // barra
    ctx.fillStyle = r.total === max ? "#B96F69" : "#667D68";
    ctx.fillRect(x, y, barW, bh);
    // etiqueta de mes cada 3
    if (i % 3 === 0 || i === data.length - 1) {
      ctx.save();
      ctx.fillStyle = "#788078";
      ctx.translate(x + barW / 2, h - padBot + 4);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = "right";
      ctx.fillText((r.mes || r.periodo).replace("-20", "-"), 0, 0);
      ctx.restore();
    }
  });
}

// ============================================================
//  SERVICE WORKER (PWA)
// ============================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js").catch(() => {}));
}
