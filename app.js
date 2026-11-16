// app.js
// Lógica de UI, envío resiliente (patrón Outbox), Background Sync y fallback 'online'.
// Regla del curso: asincronía solo con new Promise(), .then(), .catch() y Promise.all().

const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';
const SYNC_TAG = 'sync-reportes';

const formIncidencia = document.getElementById('form-incidencia');
const inputTitulo = document.getElementById('titulo');
const inputDescripcion = document.getElementById('descripcion');
const listaOutbox = document.getElementById('lista-outbox');
const btnPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');

// ---------------------------------------------------------------------------
// Registro del Service Worker + puente de mensajes (Fragmento G)
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  // sw.js avisa con postMessage cuando terminó de sincronizar en segundo plano
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });

  window.addEventListener('load', () => {
    // Ruta relativa: en GitHub Pages el scope queda en /pwa-outbox-practica/
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('[SW] Registrado con scope:', reg.scope))
      .catch((error) => console.error('[SW] Error al registrar:', error));
  });
}

// ---------------------------------------------------------------------------
// Indicador visual de red
// ---------------------------------------------------------------------------
function actualizarIndicadorRed() {
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge online';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge offline';
  }
}

// ---------------------------------------------------------------------------
// READ: dibuja la cola de IndexedDB en pantalla
// ---------------------------------------------------------------------------
function formatearHora(timestamp) {
  return new Date(timestamp).toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderizarColaOutbox() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      listaOutbox.innerHTML = '';

      if (registros.length === 0) {
        const vacio = document.createElement('li');
        vacio.className = 'vacio';
        vacio.textContent = 'La bandeja de salida está vacía.';
        listaOutbox.appendChild(vacio);
        return;
      }

      // Más recientes primero
      registros
        .sort((a, b) => b.fechaCreacion - a.fechaCreacion)
        .forEach((item) => {
          const li = document.createElement('li');
          li.className = item.estado;

          const info = document.createElement('div');
          info.className = 'item-info';

          const titulo = document.createElement('span');
          titulo.className = 'item-titulo';
          titulo.textContent = `#${item.id} · ${item.titulo}`;

          const hora = document.createElement('span');
          hora.className = 'item-hora';
          hora.textContent = `Creado: ${formatearHora(item.fechaCreacion)}`;
          if (item.fechaSincronizacion) {
            hora.textContent += ` · Sincronizado: ${formatearHora(item.fechaSincronizacion)}`;
          }

          info.appendChild(titulo);
          info.appendChild(hora);

          const estado = document.createElement('span');
          estado.className = `estado ${item.estado}`;
          estado.textContent = item.estado;

          li.appendChild(info);
          li.appendChild(estado);
          listaOutbox.appendChild(li);
        });
    })
    .catch((error) => {
      console.error('[Outbox] Error al leer IndexedDB:', error);
    });
}

// ---------------------------------------------------------------------------
// CREATE: envío resiliente con fallback a IndexedDB (Fragmentos B + E)
// ---------------------------------------------------------------------------
function registrarSyncEnServiceWorker() {
  // Detección de soporte para Background Sync API
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    return navigator.serviceWorker.ready
      .then((registro) => {
        console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
        return registro.sync.register(SYNC_TAG);
      });
  }
  console.log('[Outbox] Sin SyncManager: se reenviará con el evento online.');
  return Promise.resolve();
}

function procesarEnvioReporte(datosFormulario) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: datosFormulario.titulo, body: datosFormulario.descripcion })
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      // Envío exitoso en vivo: bitácora local como 'sincronizado'
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now(),
        fechaSincronizacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');
      // Falla de red: encolar como 'pendiente' y delegar el reenvío al SW
      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => registrarSyncEnServiceWorker())
        .catch((error) => {
          console.error('[Outbox] No se pudo registrar el sync:', error);
        });
    })
    .then(() => {
      // Actualizar la lista visual en ambos escenarios
      return renderizarColaOutbox();
    });
}

// ---------------------------------------------------------------------------
// UPDATE (fallback): reenvío desde la UI para navegadores sin SyncManager
// (antes sincronizarPendientes(), renombrada para Safari/iOS y Firefox)
// ---------------------------------------------------------------------------
function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Cada registro pendiente se convierte en una promesa de envío + actualización
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

// ---------------------------------------------------------------------------
// Eventos de red (Fragmento F: evita condición de carrera con el SW)
// ---------------------------------------------------------------------------
window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradación elegante: solo sincronizar desde la UI si NO hay Background Sync
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// ---------------------------------------------------------------------------
// Formulario (submit)
// ---------------------------------------------------------------------------
formIncidencia.addEventListener('submit', (e) => {
  e.preventDefault();

  const datosFormulario = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };

  if (!datosFormulario.titulo || !datosFormulario.descripcion) return;

  formIncidencia.reset();
  procesarEnvioReporte(datosFormulario)
    .catch((error) => console.error('[Outbox] Error al procesar el reporte:', error));
});

// ---------------------------------------------------------------------------
// DELETE: purgar registros ya sincronizados
// ---------------------------------------------------------------------------
btnPurgar.addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(sincronizados.map((item) => eliminarRegistro(item.id)));
    })
    .then((resultados) => {
      console.log(`[Outbox] Purgados ${resultados.length} registros sincronizados.`);
      return renderizarColaOutbox();
    })
    .catch((error) => console.error('[Outbox] Error al purgar:', error));
});

// ---------------------------------------------------------------------------
// Arranque: READ inicial (rescata los pendientes tras cerrar/reabrir la pestaña)
// ---------------------------------------------------------------------------
actualizarIndicadorRed();
renderizarColaOutbox().then(() => {
  // Si la app se abre ya con red en un navegador sin SyncManager, vaciar la cola
  if (navigator.onLine && !('SyncManager' in window)) {
    sincronizarPendientesFallback();
  }
});
