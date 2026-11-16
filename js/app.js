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
      <button class="cuenta-check" data-act="toggle">${c.pagada ? "✓" : ""}</button>
      <div class="cuenta-body">
        <div class="cuenta-nombre"></div>
        <div class="cuenta-meta">
          ${c.venc && c.venc !== "9999-12-31" ? `<span class="cuenta-venc ${vencida ? "vencida" : ""}">📅 ${fmtFecha(c.venc)}${vencida ? " ¡vencida!" : ""}</span>` : ""}
          <span>· ${c.createdBy || ""}</span>
        </div>
      </div>
      <span class="cuenta-monto">${fmtMonto(c.monto)}</span>
      <button class="cuenta-del" data-act="del" aria-label="Eliminar">🗑️</button>
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
      <button class="compra-check" data-act="toggle">${c.comprado ? "✓" : ""}</button>
      <span class="compra-text"></span>
      ${c.cant ? `<span class="compra-cant"></span>` : ""}
      <button class="cuenta-del" data-act="del" aria-label="Eliminar">🗑️</button>
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
const COLORES = ["#fff7a8", "#ffd6a5", "#caffbf", "#a0e7ff", "#ffc6e5", "#e0d4ff"];
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
      <button class="nota-del" data-act="del" aria-label="Eliminar">🗑️</button>
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
//  SERVICE WORKER (PWA)
// ============================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js").catch(() => {}));
}
