// Notificaciones locales de Admin 1405 (sin servidor).
// Funcionan mientras la app esté abierta o en segundo plano en el teléfono.
const KEY = "admin1405-notif";        // "on" | "off" (preferencia por dispositivo)
const KEY_DIA = "admin1405-notif-dia"; // último día en que se avisó de vencimientos

export const soportadas = () => typeof Notification !== "undefined";
export function activas() {
  if (!soportadas() || Notification.permission !== "granted") return false;
  try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; }
}
export function guardarPref(on) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) {}
}
// Devuelve "granted" | "denied" | "default" | "unsupported"
export async function pedirPermiso() {
  if (!soportadas()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
}
export async function notificar(titulo, cuerpo, tag) {
  if (!activas()) return false;
  const opts = { body: cuerpo, tag, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png" };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg && reg.showNotification) { await reg.showNotification(titulo, opts); return true; }
    new Notification(titulo, opts); return true;
  } catch (e) { return false; }
}
// Avisa como máximo una vez al día de cuentas vencidas / que vencen hoy o mañana
export async function avisarVencimientos(pend, hoy, manana, fmtMonto) {
  const urgentes = pend.filter((p) => p.venc && p.venc <= manana && p.venc !== "9999-12-31");
  if (!urgentes.length) return false;
  try { if (localStorage.getItem(KEY_DIA) === hoy) return false; } catch (e) {}
  const venc = urgentes.filter((p) => p.venc < hoy).length;
  const hoyN = urgentes.filter((p) => p.venc === hoy).length;
  const man = urgentes.filter((p) => p.venc === manana).length;
  const partes = [];
  if (venc) partes.push(`${venc} vencida${venc > 1 ? "s" : ""}`);
  if (hoyN) partes.push(`${hoyN} vence${hoyN > 1 ? "n" : ""} hoy`);
  if (man) partes.push(`${man} vence${man > 1 ? "n" : ""} mañana`);
  const detalle = urgentes.slice(0, 3).map((p) => p.nombre + (p.monto ? " " + fmtMonto(p.monto) : "")).join(" · ");
  const ok = await notificar("Cuentas por pagar", `${partes.join(", ")}: ${detalle}`, "vencimientos");
  if (ok) { try { localStorage.setItem(KEY_DIA, hoy); } catch (e) {} }
  return ok;
}
