// server.js — versão com pequenas melhorias: validação, mensagens mais claras e segurança básica
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');

let fetchFn;
if (globalThis.fetch) fetchFn = globalThis.fetch; else try { fetchFn = require('node-fetch'); } catch (e) { console.error('Instale node-fetch ou use Node 18+'); process.exit(1); }

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) { console.error('ERRO: defina GOOGLE_API_KEY no .env'); process.exit(1); }

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TYPE_MAP = { veterinario: { type: 'veterinary_care' }, petshop: { type: 'pet_store' }, ong: { type: 'establishment', keyword: 'animal shelter' } };

app.get('/api/places', async (req, res) => {
  try {
    const { lat, lng, type = 'veterinario', radius = 5000 } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat e lng obrigatórios' });
    const mapInfo = TYPE_MAP[type] || TYPE_MAP.veterinario;
    const params = new URLSearchParams({ location: `${lat},${lng}`, radius: String(radius), key: API_KEY });
    if (mapInfo.type) params.append('type', mapInfo.type);
    if (mapInfo.keyword) params.append('keyword', mapInfo.keyword);

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
    const r = await fetchFn(url);
    const json = await r.json();

    if (json.status && json.status !== 'OK' && json.status !== 'ZERO_RESULTS') return res.status(500).json({ error: 'Google Places error', details: json });

    const items = (json.results || []).map(p => ({ id: p.place_id, name: p.name, lat: p.geometry.location.lat, lng: p.geometry.location.lng, types: p.types, vicinity: p.vicinity, rating: p.rating, user_ratings_total: p.user_ratings_total }));
    res.json({ results: items, next_page_token: json.next_page_token || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/geocode', async (req, res) => {
  try {
    const { q } = req.query; if (!q) return res.status(400).json({ error: 'q obrigatório' });
    const params = new URLSearchParams({ address: q, key: API_KEY });
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
    const r = await fetchFn(url); const json = await r.json();
    res.json(json);
  } catch (err) { console.error(err); res.status(500).json({ error: 'server error' }); }
});

app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`PetDex API rodando em http://localhost:${PORT}`));