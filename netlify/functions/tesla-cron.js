// ============================================================
// TESLA KM — Cron Job Netlify
// S'exécute tous les jours à 20h00 (heure de Paris)
// Récupère le kilométrage Tesla et l'insère dans Supabase
// ============================================================

const https = require('https');

function httpsPost(hostname, path, data, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }, headers || {})
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'TeslaKM/1.0',
        'Content-Type': 'application/json'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve({}); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function supabaseUpsert(url, key, table, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const urlObj = new URL(`${url}/rest/v1/${table}?on_conflict=entry_date`);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'resolution=merge-duplicates'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async function(event) {
  const REFRESH_TOKEN  = process.env.TESLA_REFRESH_TOKEN;
  const SUPABASE_URL   = process.env.SUPABASE_URL   || 'https://shvudefpkgyukkmhptgk.supabase.co';
  const SUPABASE_KEY   = process.env.SUPABASE_KEY   || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNodnVkZWZwa2d5dWtrbWhwdGdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzkwNTYsImV4cCI6MjA5MjI1NTA1Nn0.mWk5i1vJ_XuMIp_UaLSXSwd7CbQiL8xPhJyMpJOwhe4';

  console.log('[TeslaKM] Cron démarré —', new Date().toISOString());

  try {
    // ---- 1. Refresh du token Tesla ----
    console.log('[TeslaKM] Rafraîchissement du token...');
    const auth = await httpsPost('auth.tesla.com', '/oauth2/v3/token', {
      grant_type: 'refresh_token',
      client_id: 'ownerapi',
      refresh_token: REFRESH_TOKEN,
      scope: 'openid email offline_access'
    });

    if (!auth.access_token) {
      console.error('[TeslaKM] Échec refresh token:', JSON.stringify(auth));
      return { statusCode: 500, body: JSON.stringify({ error: 'Token refresh failed', details: auth }) };
    }
    console.log('[TeslaKM] Token rafraîchi ✓');

    // ---- 2. Récupération des véhicules ----
    const vehicles = await httpsGet('owner-api.teslamotors.com', '/api/1/vehicles', auth.access_token);
    if (!vehicles.response || !vehicles.response.length) {
      console.error('[TeslaKM] Aucun véhicule trouvé');
      return { statusCode: 500, body: JSON.stringify({ error: 'No vehicles found' }) };
    }

    const vehicle = vehicles.response[0];
    const vehicleId = vehicle.id_s;
    console.log('[TeslaKM] Véhicule trouvé:', vehicle.display_name, '— ID:', vehicleId);

    // ---- 3. Réveil du véhicule si nécessaire ----
    if (vehicle.state !== 'online') {
      console.log('[TeslaKM] Véhicule en veille, réveil...');
      await httpsPost('owner-api.teslamotors.com', `/api/1/vehicles/${vehicleId}/wake_up`, {}, {
        'Authorization': `Bearer ${auth.access_token}`,
        'User-Agent': 'TeslaKM/1.0'
      });
      // Attendre 10 secondes
      await new Promise(r => setTimeout(r, 10000));
    }

    // ---- 4. Récupération des données véhicule ----
    console.log('[TeslaKM] Récupération des données...');
    const data = await httpsGet(
      'owner-api.teslamotors.com',
      `/api/1/vehicles/${vehicleId}/vehicle_data`,
      auth.access_token
    );

    if (!data.response || !data.response.vehicle_state) {
      console.error('[TeslaKM] Données véhicule invalides:', JSON.stringify(data));
      return { statusCode: 500, body: JSON.stringify({ error: 'Invalid vehicle data', details: data }) };
    }

    const odometer_miles = data.response.vehicle_state.odometer;
    const odometer_km    = Math.round(odometer_miles * 1.60934);
    console.log('[TeslaKM] Kilométrage:', odometer_km, 'km (', odometer_miles, 'miles)');

    // ---- 5. Insertion dans Supabase ----
    const today = new Date().toISOString().slice(0, 10);
    const result = await supabaseUpsert(SUPABASE_URL, SUPABASE_KEY, 'km_entries', {
      entry_date:  today,
      compteur_km: odometer_km,
      month_key:   today.slice(0, 7),
      updated_at:  new Date().toISOString()
    });

    console.log('[TeslaKM] Supabase réponse:', result.status);

    if (result.status >= 200 && result.status < 300) {
      console.log('[TeslaKM] ✅ Succès — ' + odometer_km + ' km enregistrés pour le ' + today);
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, date: today, km: odometer_km })
      };
    } else {
      console.error('[TeslaKM] Erreur Supabase:', result.body);
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase error', details: result.body }) };
    }

  } catch(e) {
    console.error('[TeslaKM] Erreur:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
