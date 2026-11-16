// ============================================================
//  CONFIGURACIÓN DE FIREBASE
//  Reemplaza los valores con los de TU proyecto de Firebase.
//  Los encuentras en: consola de Firebase > Configuración del
//  proyecto (⚙️) > "Tus apps" > app web > SDK de Firebase.
//
//  NOTA: estas claves NO son secretas. En apps web de Firebase
//  son públicas a propósito; la seguridad se controla con el
//  login (Authentication) y las reglas de Firestore
//  (ver firestore.rules).
// ============================================================

export const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};
