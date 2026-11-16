# pwa-outbox-practica

PWA de **Registro de Incidencias en Campo** con persistencia offline (Temas 5.1 – 5.3).

- **db-helper.js** – mini-wrapper promisificado de IndexedDB (`abrirDB`, `guardarRegistro`, `obtenerTodosLosRegistros`, `actualizarEstadoRegistro`, `eliminarRegistro`).
- **app.js** – UI, envío resiliente (patrón Outbox), registro de `sync-reportes`, recepción de `postMessage` y fallback por evento `online` para navegadores sin `SyncManager`.
- **sw.js** – App Shell en Cache API (`static-outbox-v2`) y motor de sincronización en segundo plano (evento `sync`).

100% JavaScript Vanilla, sin librerías y con asincronía resuelta únicamente mediante `new Promise()`, `.then()`, `.catch()` y `Promise.all()`.
