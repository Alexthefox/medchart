const CACHE = 'medchart-v3';
const CORE = [
  '/medchart/',
  '/medchart/index.html',
  '/medchart/manifest.json',
  '/medchart/icon-192.png',
  '/medchart/icon-512.png',
];

// ── Cache ──────────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (url.includes('googleapis.com') || url.includes('accounts.google') ||
      url.includes('gstatic.com') || url.includes('unpkg.com') ||
      url.includes('cdnjs.cloudflare') || url.includes('fonts.goog')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

// ── Alarm scheduling ──────────────────────────────────────────────────────────
let _timers = [];          // {id: timeoutId, oraKey, attempt}
let _snooze  = {};         // oraKey -> timeoutId

function cancelAll() {
  _timers.forEach(t => clearTimeout(t.id));
  _timers = [];
  Object.values(_snooze).forEach(t => clearTimeout(t));
  _snooze = {};
}

function scheduleAlarms(alarms) {
  cancelAll();
  alarms.forEach(a => {
    if (a.msToFire < 0) return;
    const id = setTimeout(() => fire(a.oraKey, a.farmaci, 1), a.msToFire);
    _timers.push({ id, oraKey: a.oraKey });
  });
  // Riprogramma domani a mezzanotte+1min
  const midnight = new Date();
  midnight.setHours(24, 1, 0, 0);
  setTimeout(() => {
    // Chiedi all'app di mandarci di nuovo gli alarms aggiornati
    self.clients.matchAll().then(clients =>
      clients.forEach(c => c.postMessage({ type: 'REQUEST_ALARMS' }))
    );
  }, midnight - Date.now());
}

async function fire(oraKey, farmList, attempt) {
  if (attempt > 6) return; // max 1 ora di tentativi

  const corpo = farmList.map(f =>
    `${f.qta}  ${f.nome}${f.dosaggio ? ' ' + f.dosaggio : ''}`
  ).join('\n');

  await self.registration.showNotification('💊 Ora di prendere le medicine', {
    body: corpo,
    icon: '/medchart/icon-192.png',
    badge: '/medchart/icon-192.png',
    tag: 'medicina-' + oraKey,
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 400],
    silent: false,
    data: { oraKey, farmList, attempt },
    actions: [
      { action: 'prese',     title: '✅ Prese!' },
      { action: 'posticipa', title: '⏰ +10 min' }
    ]
  });

  // Auto-snooze se non risponde entro 10 min
  _snooze[oraKey] = setTimeout(() => {
    fire(oraKey, farmList, attempt + 1);
  }, 10 * 60 * 1000);
}

// ── Gestione click notifica ───────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  const { oraKey, farmList, attempt } = e.notification.data || {};
  e.notification.close();

  if (e.action === 'prese') {
    // Cancella snooze
    if (_snooze[oraKey]) { clearTimeout(_snooze[oraKey]); delete _snooze[oraKey]; }
    // Notifica app
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'PRESE_CONFERMATE', oraKey }));
        if (clients.length) return clients[0].focus();
        return self.clients.openWindow('/medchart/#terapia');
      })
    );

  } else if (e.action === 'posticipa') {
    // Cancella auto-snooze e riprogramma manualmente
    if (_snooze[oraKey]) { clearTimeout(_snooze[oraKey]); delete _snooze[oraKey]; }
    const minuti = 10;
    _snooze[oraKey] = setTimeout(() => fire(oraKey, farmList, attempt), minuti * 60 * 1000);
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients =>
        clients.forEach(c => c.postMessage({ type: 'POSTICIPATO', oraKey, minuti }))
      )
    );

  } else {
    // Click sul corpo — apri app
    e.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        const focused = clients.find(c => c.url.includes('medchart'));
        if (focused) return focused.focus();
        return self.clients.openWindow('/medchart/#terapia');
      })
    );
  }
});

// ── Messaggi dall'app ─────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_ALARMS') {
    scheduleAlarms(e.data.payload?.alarms || []);
  }
  if (e.data?.type === 'CANCEL_ALARMS') {
    cancelAll();
  }
  if (e.data?.type === 'TEST_NOTIF') {
    fire('TEST', [{ nome: 'Farmaco di test', dosaggio: '0.5mg', qta: '1 cp' }], 1);
  }
});

console.log('MedChart SW v3 loaded');
