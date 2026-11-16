# 📌 Admin 1405

App web (PWA) para llevar un **diario mural compartido** entre dos personas:

- 💳 **Cuentas** — registro de cuentas por pagar (monto, vencimiento, pagado/pendiente).
- 🛒 **Supermercado** — lista de pendientes para comprar, con check y "quitar comprados".
- 📝 **Información** — notas tipo post-it en un mural de corcho.

Todo se **sincroniza en tiempo real** entre los dos dispositivos con Firebase (Firestore),
e inicia sesión con usuario/contraseña que **queda guardada** (no hay que escribirla cada vez).

---

## 🧱 Tecnología

- HTML + CSS + JavaScript puro (sin paso de compilación).
- [Firebase](https://firebase.google.com) — Authentication (email/clave) + Firestore (datos en vivo).
- PWA: instalable en el teléfono, con ícono propio y pantalla completa.

No requiere servidor propio: se puede alojar en **Firebase Hosting** o en tu **hosting cPanel (iHost)**
como sitio estático.

---

## 🚀 Puesta en marcha (una sola vez)

### 1. Crear el proyecto de Firebase
1. Entra a <https://console.firebase.google.com> y crea un proyecto nuevo.
2. Entra a **Compilación › Authentication › Comenzar** y activa el método **Correo electrónico/contraseña**.
3. En **Authentication › Users**, crea las **dos cuentas** (la tuya y la de tu esposa) con correo y clave.
   *(No hay registro público: solo entran las cuentas que crees aquí.)*
4. Entra a **Compilación › Firestore Database › Crear base de datos** (modo producción).

### 2. Conectar la app con tu Firebase
1. En Firebase: **⚙️ Configuración del proyecto › Tus apps › App web (`</>`)**. Registra una app web.
2. Copia los valores del objeto `firebaseConfig` y pégalos en **`js/firebase-config.js`**.

### 3. Aplicar las reglas de seguridad
1. Abre **`firestore.rules`** de este repo.
2. Reemplaza los correos de ejemplo por los **dos correos reales**.
3. Pega el contenido en **Firestore Database › pestaña Reglas › Publicar**.

> Las claves de `firebase-config.js` **no son secretas** (en Firebase web son públicas a propósito).
> La seguridad real la dan el login y las reglas de Firestore con la lista blanca de correos.

### 4. Publicar la app
**Opción A — Firebase Hosting** (gratis, HTTPS incluido):
```bash
npm install -g firebase-tools
firebase login
firebase init hosting      # carpeta pública: . (la raíz)
firebase deploy
```

**Opción B — tu hosting cPanel (iHost):**
Sube todos los archivos a `public_html/` (o a una subcarpeta/subdominio) por el Administrador de archivos o FTP.
Debe servirse por **HTTPS** para que funcione la PWA y el login.

### 5. Instalar en el teléfono
Abre la URL en el navegador del celular → menú → **"Agregar a pantalla de inicio" / "Instalar app"**.

---

## 📂 Estructura

```
admin1405/
├─ index.html              Interfaz
├─ css/styles.css          Estilos (mural de corcho, mobile-first)
├─ js/
│  ├─ firebase-config.js   ← AQUÍ pegas tu configuración de Firebase
│  └─ app.js               Lógica: login + 3 secciones en tiempo real
├─ icons/                  Íconos de la PWA
├─ manifest.json           Config de instalación (PWA)
├─ sw.js                   Service worker (abre offline)
└─ firestore.rules         Reglas de seguridad (lista blanca de correos)
```

## 🗃️ Datos en Firestore

Tres colecciones, compartidas por ambas cuentas:

| Colección  | Campos                                                        |
|------------|---------------------------------------------------------------|
| `cuentas`  | `nombre`, `monto`, `venc`, `pagada`, `createdBy`, `createdAt` |
| `compras`  | `item`, `cant`, `comprado`, `createdBy`, `createdAt`          |
| `notas`    | `titulo`, `contenido`, `color`, `createdBy`, `createdAt`      |
