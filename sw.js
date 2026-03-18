// MedChart Service Worker v1
// Gestisce notifiche farmaci con posticipa e conferma presa

const CACHE='medchart-v1';

self.addEventListener('install',e=>{
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(clients.claim());
});

// ── Allarmi in memoria (persistiti via postMessage) ───────────────────────────
// Map: oraKey -> {timer, tentativi, farmaci:[{nome,qta}]}
const alarmsActive = new Map();

// ── Messaggi dall'app ─────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  const {type, payload} = e.data || {};

  if(type === 'SCHEDULE_ALARMS'){
    // Cancella tutti i timer precedenti
    for(const [k, a] of alarmsActive){
      clearTimeout(a.timer);
    }
    alarmsActive.clear();

    // payload.alarms = [{oraKey:'08:00', msToFire:3600000, farmaci:[{nome,qta}]}]
    for(const alarm of (payload.alarms||[])){
      scheduleAlarm(alarm.oraKey, alarm.msToFire, alarm.farmaci, 0);
    }
  }

  if(type === 'PRESE_CONFERMATE'){
    // Utente ha confermato la presa — cancella eventuale retry
    const key = payload.oraKey;
    if(alarmsActive.has(key)){
      clearTimeout(alarmsActive.get(key).timer);
      alarmsActive.delete(key);
    }
  }

  if(type === 'POSTICIPA'){
    // Posticipa di 10 min
    const key = payload.oraKey;
    if(alarmsActive.has(key)){
      const a = alarmsActive.get(key);
      clearTimeout(a.timer);
      const tentativo = (a.tentativo||0) + 1;
      if(tentativo <= 6){ // max 6 posticipazioni = 1 ora
        scheduleAlarm(key, 10*60*1000, a.farmaci, tentativo);
      } else {
        alarmsActive.delete(key);
      }
    }
  }
});

function scheduleAlarm(oraKey, msDelay, farmaci, tentativo){
  const timer = setTimeout(()=>{
    fireNotification(oraKey, farmaci, tentativo);
  }, msDelay);
  alarmsActive.set(oraKey, {timer, farmaci, tentativo});
}

async function fireNotification(oraKey, farmaci, tentativo){
  const title = tentativo === 0
    ? `💊 Ora di prendere le medicine (${oraKey})`
    : `⏰ Promemoria medicine (${oraKey}) — tentativo ${tentativo+1}`;

  const body = farmaci.map(f=>`• ${f.nome}${f.dosaggio?' '+f.dosaggio:''} — ${f.qta}`).join('\n');

  await self.registration.showNotification(title,{
    body,
    icon: '/medchart/icon-192.png',
    badge: '/medchart/icon-72.png',
    tag: `farmaco-${oraKey}`,   // stesso tag → sostituisce notifica precedente
    renotify: true,
    requireInteraction: true,   // non sparisce da sola su Android
    vibrate: [200,100,200,100,200],
    actions:[
      {action:'prese',   title:'✅ Prese'},
      {action:'posticipa', title:'⏸ +10 min'},
    ],
    data: {oraKey, farmaci, tentativo}
  });

  // Programma automatico re-fire dopo 10 min se nessuna risposta
  if(tentativo < 6){
    scheduleAlarm(oraKey, 10*60*1000, farmaci, tentativo+1);
  } else {
    alarmsActive.delete(oraKey);
  }
}

// ── Tap sulle azioni della notifica ──────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const {oraKey, farmaci, tentativo} = e.notification.data || {};

  if(e.action === 'prese'){
    // Cancella retry
    if(alarmsActive.has(oraKey)){
      clearTimeout(alarmsActive.get(oraKey).timer);
      alarmsActive.delete(oraKey);
    }
    // Notifica l'app
    notifyClients({type:'PRESE_CONFERMATE', oraKey});
  }

  else if(e.action === 'posticipa'){
    // Cancella retry corrente e posticipa
    if(alarmsActive.has(oraKey)){
      clearTimeout(alarmsActive.get(oraKey).timer);
    }
    const nextTentativo = (tentativo||0) + 1;
    if(nextTentativo <= 6){
      scheduleAlarm(oraKey, 10*60*1000, farmaci, nextTentativo);
    } else {
      alarmsActive.delete(oraKey);
    }
  }

  else {
    // Tap sul corpo — apre l'app
    e.waitUntil(
      clients.matchAll({type:'window'}).then(cs=>{
        if(cs.length) cs[0].focus();
        else clients.openWindow('/medchart/');
      })
    );
  }
});

async function notifyClients(msg){
  const cs = await clients.matchAll({type:'window'});
  cs.forEach(c => c.postMessage(msg));
}

// ── Fetch (cache-first per offline) ──────────────────────────────────────────
self.addEventListener('fetch', e=>{
  // Solo GET, solo stesso origine
  if(e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached=>{
      return cached || fetch(e.request).catch(()=>cached);
    })
  );
});
