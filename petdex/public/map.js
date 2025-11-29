let map, placesService, directionsService, directionsRenderer;
let markers = [], userMarker = null, userLatLng = null, circle = null;
let lastPlaces = [];            // last results from nearbySearch
let lastPlacesTs = 0;

// Map styles
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#000000" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9aa4b2" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#000000" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#9aa4b2" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#0b0b0b" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#6b6f76" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] }
];
const LIGHT_MAP_STYLE = null;

function initMap() {
  const defaultCenter = { lat: -23.55052, lng: -46.633308 };
  map = new google.maps.Map(document.getElementById('map'), {
    center: defaultCenter,
    zoom: 13,
    streetViewControl: false,
    mapTypeControl: false,
    styles: null
  });

  placesService = new google.maps.places.PlacesService(map);
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map });

  // Basic UI wiring
  addListenerIfExists('locateBtn', 'click', tryLocateUser);
  addListenerIfExists('searchBtn', 'click', onSearchAddress);
  addListenerIfExists('clearBtn', 'click', clearAll);
  addListenerIfExists('zoomIn', 'click', () => map.setZoom(Math.min(map.getZoom() + 1, 21)));
  addListenerIfExists('zoomOut', 'click', () => map.setZoom(Math.max(map.getZoom() - 1, 0)));
  addListenerIfExists('distance', 'change', onDistanceChange);
  addListenerIfExists('toggleSidebar', 'click', toggleSidebar);

  // Filters - select + checkbox + clear button (IDs presentes no index.html)
  const sortSelect = document.getElementById('sortSelect');
  const openNowCheckbox = document.getElementById('filterOpenNow');
  const clearFiltersBtn = document.getElementById('clearFiltersBtn');

  if (sortSelect) sortSelect.addEventListener('change', () => renderPlaces());
  if (openNowCheckbox) openNowCheckbox.addEventListener('change', () => renderPlaces());
  if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', () => {
    if (sortSelect) sortSelect.value = 'distance';
    if (openNowCheckbox) openNowCheckbox.checked = false;
    renderPlaces();
  });

  // Dark toggle wiring
  const darkToggle = document.getElementById('darkToggle');
  if (darkToggle) {
    darkToggle.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark');
      darkToggle.setAttribute('aria-pressed', String(isDark));
      localStorage.setItem('petdex-dark', isDark ? '1' : '0');
      applyMapStyle(isDark);
      updateDarkIcon(isDark);
      if (userMarker) setUserMarker(); // re-create marker & circle if needed
    });
  }

  // initial theme from localStorage or prefers-color-scheme
  try {
    const saved = localStorage.getItem('petdex-dark');
    let initialDark = false;
    if (saved === '1') initialDark = true;
    else if (saved === '0') initialDark = false;
    else initialDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (initialDark) {
      document.body.classList.add('dark');
      updateDarkIcon(true);
      applyMapStyle(true);
    } else {
      document.body.classList.remove('dark');
      updateDarkIcon(false);
      applyMapStyle(false);
    }
  } catch (e) { console.warn('theme init fail', e); }

  // category chips (present in index.html)
  document.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
      ch.classList.add('active');
      if (userLatLng) searchNearby(userLatLng);
    });
  });

  const closeModal = document.getElementById('closeModal');
  if (closeModal) closeModal.addEventListener('click', () => document.getElementById('profileModal').setAttribute('aria-hidden', 'true'));

  // Autocomplete (if available)
  const input = document.getElementById('addrInput');
  try {
    if (google && google.maps && google.maps.places && input) {
      const autocomplete = new google.maps.places.Autocomplete(input, { types: ['geocode'] });
      autocomplete.addListener('place_changed', () => {
        const p = autocomplete.getPlace();
        if (p && p.geometry && p.geometry.location) {
          userLatLng = { lat: p.geometry.location.lat(), lng: p.geometry.location.lng() };
          setUserMarker();
          searchNearby(userLatLng);
        }
      });
    }
  } catch (e) { /* ignore if lib missing */ }

  // Make distance and sort selects cycle on click (user request)
  enableCyclicSelect('distance');
  enableCyclicSelect('sortSelect');

  tryLocateUser(true);
}

function applyMapStyle(isDark) {
  try {
    map.setOptions({ styles: isDark ? DARK_MAP_STYLE : LIGHT_MAP_STYLE });
  } catch (e) {
    console.warn('applyMapStyle error', e);
  }
}

function updateDarkIcon(isDark) {
  const icon = document.getElementById('darkIcon');
  if (!icon) return;
  icon.textContent = isDark ? 'light_mode' : 'dark_mode';
}

// toggle sidebar (simple collapse class)
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');
}

// radius change handler
function onDistanceChange() {
  const distEl = document.getElementById('distance');
  const value = Number(distEl?.value || 5000);
  if (circle) {
    circle.setRadius(value);
    try {
      const bounds = circle.getBounds();
      if (bounds) map.fitBounds(bounds, 60);
    } catch (e) {}
  }
  if (userLatLng) searchNearby(userLatLng);
}

// Geolocation
function tryLocateUser(initial = false) {
  if (!navigator.geolocation) { if (!initial) alert('Seu navegador não suporta geolocalização'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setUserMarker();
    searchNearby(userLatLng);
  }, err => {
    if (!initial) alert('Não foi possível obter sua localização: ' + (err.message || err.code));
    console.warn('geolocation error', err);
  }, { enableHighAccuracy: true, timeout: 8000 });
}

function setUserMarker() {
  if (!userLatLng) return;
  if (userMarker) userMarker.setMap(null);
  if (circle) circle.setMap(null);

  const isDark = document.body.classList.contains('dark');
  const iconUrl = isDark ? 'https://maps.gstatic.com/mapfiles/ms2/micons/blue.png' : 'https://maps.gstatic.com/mapfiles/ms2/micons/blue-dot.png';

  userMarker = new google.maps.Marker({
    map,
    position: userLatLng,
    title: 'Você está aqui',
    icon: iconUrl
  });

  const radius = Number(document.getElementById('distance')?.value || 5000);
  circle = new google.maps.Circle({
    map,
    center: userLatLng,
    radius,
    strokeColor: '#f7882f',
    strokeOpacity: 0.35,
    fillColor: '#f7882f',
    fillOpacity: 0.06
  });

  map.panTo(userLatLng);
  map.setZoom(13);
}

// geocode address
function onSearchAddress() {
  const q = document.getElementById('addrInput')?.value.trim();
  if (!q) return;
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ address: q }, (results, status) => {
    if (status !== 'OK' || !results || !results.length) return alert('Endereço não encontrado.');
    const loc = results[0].geometry.location;
    userLatLng = { lat: loc.lat(), lng: loc.lng() };
    setUserMarker();
    searchNearby(userLatLng);
  });
}

// search nearby and store results
function searchNearby(latlng) {
  clearMarkers();
  try { directionsRenderer.set('directions', null); } catch(e){}

  const timestamp = Date.now();
  lastPlacesTs = timestamp;

  // ensure previous search results are cleared when a new search starts
  lastPlaces = [];

  const category = document.querySelector('.chip.active')?.dataset?.cat || 'veterinario';
  const radius = Number(document.getElementById('distance')?.value || 5000);

  const TYPE_MAP = {
    veterinario: { type: 'veterinary_care' },
    petshop: { type: 'pet_store' },
    ong: { keyword: 'animal shelter' }
  };

  const mapInfo = TYPE_MAP[category] || TYPE_MAP.veterinario;
  const req = { location: new google.maps.LatLng(latlng.lat, latlng.lng), radius };
  if (mapInfo.type) req.type = mapInfo.type;
  if (mapInfo.keyword) req.keyword = mapInfo.keyword;

  const resultsBox = document.getElementById('results');
  if (resultsBox) resultsBox.innerHTML = '<div class="muted small">Buscando...</div>';
  const rc = document.getElementById('resultsCount'); if (rc) rc.textContent = '';

  placesService.nearbySearch(req, function handleResults(places, status, pagination) {
    if (status !== google.maps.places.PlacesServiceStatus.OK || !places) {
        lastPlaces = [];
        renderPlaces();
        return;
    }

    // adiciona os resultados desta página
    lastPlaces = lastPlaces.concat(places);

    // se existir próxima página → carrega, sem exibir nada ainda
    if (pagination && pagination.hasNextPage) {
        pagination.nextPage(); // chama a próxima página
        return;                // NÃO renderiza ainda
    }

    // se chegou aqui → ACABOU TODAS AS PÁGINAS
    // agora sim, renderiza tudo de uma vez
    lastPlaces = dedupePlacesById(lastPlaces);
    renderPlaces();
});

}

/**
 * renderPlaces()
 * Applies filters (sortSelect + openNow) and renders markers + cards.
 */
function renderPlaces() {
  clearMarkers();
  try { directionsRenderer.set('directions', null); } catch(e){}

  const resultsBox = document.getElementById('results');
  if (!resultsBox) return; // nothing to render into
  resultsBox.innerHTML = '';

  if (!lastPlaces || !lastPlaces.length) {
    resultsBox.innerHTML = '<div class="muted small">Nenhum local encontrado.</div>';
    const rc = document.getElementById('resultsCount'); if (rc) rc.textContent = '0 mostrados (0 encontrados)';
    return;
  }

  // read filters
  const sortOption = document.getElementById('sortSelect')?.value || 'distance';
  const openNowOnly = document.getElementById('filterOpenNow')?.checked;

  // map places to meta objects (distance, pos)
  const withMeta = lastPlaces.map(p => {
    const pos = (p.geometry && p.geometry.location) ? { lat: p.geometry.location.lat(), lng: p.geometry.location.lng() } : null;
    const dist = (userLatLng && pos) ? haversine(userLatLng, pos) : Number.POSITIVE_INFINITY;
    return Object.assign({}, p, { _distance: dist, _pos: pos });
  });

  // apply openNow filter conservatively: only keep items with opening_hours.open_now === true
  let filtered = withMeta;
  if (openNowOnly) {
    filtered = filtered.filter(p => {
      if (p.opening_hours && typeof p.opening_hours.open_now !== 'undefined') {
        return p.opening_hours.open_now === true;
      }
      // exclude if unknown (conservative)
      return false;
    });
  }

  // sort
  if (sortOption === 'distance') {
    filtered.sort((a,b) => (a._distance || 0) - (b._distance || 0));
  } else if (sortOption === 'rating') {
    filtered.sort((a,b) => (b.rating || 0) - (a.rating || 0));
  }

  // render markers + cards
  filtered = dedupePlacesById(filtered);
  filtered.forEach(place => {
    if (!place._pos) return;
    const marker = new google.maps.Marker({ map, position: new google.maps.LatLng(place._pos.lat, place._pos.lng), title: place.name });
    markers.push(marker);

    const card = buildResultCard(place, place._pos);
    resultsBox.appendChild(card);
  });

  const rc = document.getElementById('resultsCount'); if (rc) rc.textContent = `${filtered.length} mostrados (${lastPlaces.length} encontrados)`;
}

/**
 * buildResultCard(place, pos)
 * Builds a card node for a place (no image). Keeps same behavior as previous versions.
 */
function buildResultCard(place, pos) {
  const card = document.createElement('div');
  card.className = 'place';

  const content = document.createElement('div');
  content.className = 'place-content';

  const info = document.createElement('div');
  info.className = 'place-info';
  const title = document.createElement('h3');
  title.textContent = place.name || 'Sem nome';
  info.appendChild(title);

  const vicinity = document.createElement('div');
  vicinity.className = 'vicinity';
  vicinity.textContent = place.vicinity || place.formatted_address || '';
  info.appendChild(vicinity);

  // rating
  const summary = document.createElement('div');
  summary.className = 'profile-summary';
  const ratingSpan = document.createElement('div');
  ratingSpan.className = 'rating-pill';
  if (place.rating) {
    ratingSpan.textContent = `⭐ ${Number(place.rating).toFixed(1)}`;
  } else {
    ratingSpan.style.display = 'none';
  }
  summary.appendChild(ratingSpan);
  info.appendChild(summary);

  // filler
  const filler = document.createElement('div');
  filler.className = 'place-filler';

  // actions
  const actions = document.createElement('div');
  actions.className = 'place-actions';
  const distanceDiv = document.createElement('div');
  distanceDiv.className = 'distance-approx';
  distanceDiv.textContent = (place._distance && isFinite(place._distance)) ? `${(place._distance/1000).toFixed(2)} km` : '';
  distanceDiv.setAttribute('data-lat', pos.lat);
  distanceDiv.setAttribute('data-lng', pos.lng);
  actions.appendChild(distanceDiv);

  // Traçar rota (preview)
  const routeBtn = document.createElement('button');
  routeBtn.className = 'route-btn';
  routeBtn.innerHTML = `<span class="material-icons" aria-hidden="true" style="font-size:18px">directions</span> Traçar rota`;
  actions.appendChild(routeBtn);

  // Google Maps external
  const googleBtn = document.createElement('button');
  googleBtn.className = 'open-profile';
  googleBtn.textContent = 'Google Maps';
  actions.appendChild(googleBtn);

  // Perfil
  const profileBtn = document.createElement('button');
  profileBtn.className = 'open-profile';
  profileBtn.textContent = 'Perfil';
  actions.appendChild(profileBtn);

  content.appendChild(info);
  content.appendChild(filler);
  content.appendChild(actions);
  card.appendChild(content);

  // link marker <-> card (marker is last pushed)
  const matchingMarker = markers[markers.length - 1];
  if (matchingMarker) {
    matchingMarker.addListener('click', () => {
      map.panTo(matchingMarker.getPosition());
      map.setZoom(15);
      openProfile(place.place_id);
    });
    matchingMarker.addListener('mouseover', () => card.classList.add('highlight'));
    matchingMarker.addListener('mouseout', () => card.classList.remove('highlight'));
  }

  // interactions
  routeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const dest = { lat: pos.lat, lng: pos.lng };
    traceRoutePreview(dest).catch(() => { alert('Não foi possível traçar rota (verifique sua localização).'); });
  });

  googleBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const dest = { lat: pos.lat, lng: pos.lng };
    openInGoogleMaps(userLatLng, dest);
  });

  profileBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openProfile(place.place_id);
  });

  content.addEventListener('click', () => openProfile(place.place_id));

  return card;
}

/**
 * openProfile(placeId)
 * Opens modal with place details (uses Places getDetails).
 */
function openProfile(placeId) {
  if (!placeId) return;
  placesService.getDetails({
    placeId,
    fields: [
      'name', 'formatted_address', 'formatted_phone_number', 'rating',
      'opening_hours', 'website', 'user_ratings_total', 'reviews', 'url', 'geometry', 'place_id'
    ]
  }, (detail, st) => {
    if (st !== google.maps.places.PlacesServiceStatus.OK || !detail) {
      return alert('Não foi possível carregar o perfil.');
    }

    const modal = document.getElementById('profileModal');
    const content = document.getElementById('profileContent');

    const rating = detail.rating ? Number(detail.rating).toFixed(1) : null;
    const ratingsTotal = detail.user_ratings_total || 0;

    let hoursHtml = '';
    if (detail.opening_hours && detail.opening_hours.weekday_text) {
      hoursHtml = `<div class=\"line\"><strong>Horário:</strong><div style=\"display:flex;flex-direction:column;gap:2px;margin-left:6px\">${detail.opening_hours.weekday_text.map(h => `<span style=\"font-size:13px;color:var(--muted)\">${escapeHtml(h)}</span>`).join('')}</div></div>`;
    } else if (detail.opening_hours && typeof detail.opening_hours.open_now !== 'undefined') {
      hoursHtml = `<div class=\"line\"><strong>Status:</strong> <span style=\"margin-left:6px\">${detail.opening_hours.open_now ? 'Aberto agora' : 'Fechado'}</span></div>`;
    }

    let reviewsHtml = '';
    if (detail.reviews && detail.reviews.length) {
      const revs = detail.reviews.slice(0,3).map(r => {
        const author = escapeHtml(r.author_name || 'Usuário');
        const text = escapeHtml((r.text || '').slice(0,300));
        return `<div class=\"rev\"><strong>${author}</strong> — ${text}</div>`;
      }).join('');
      reviewsHtml = `<div class=\"reviews\">${revs}</div>`;
    }

    const phoneHtml = detail.formatted_phone_number ? `<a href="tel:${detail.formatted_phone_number.replace(/[^+\\d]/g,'')}" class="line">${escapeHtml(detail.formatted_phone_number)}</a>` : '';
    const websiteHtml = detail.website ? `<a href="${detail.website}" target="_blank" rel="noopener noreferrer"></a>` : '';

    let distanceHtml = '';
    if (userLatLng && detail.geometry && detail.geometry.location) {
      const pos = { lat: detail.geometry.location.lat(), lng: detail.geometry.location.lng() };
      const d = haversine(userLatLng, pos);
      distanceHtml = `<div class=\"line\"><strong>Distância:</strong> <span style=\"margin-left:6px\">${(d/1000).toFixed(2)} km</span></div>`;
    }

    content.innerHTML = `
      <div class=\"profile-content\">
        <div class=\"profile-header\">
          <div style=\"display:flex;flex-direction:column;gap:6px\">
            <h2>${escapeHtml(detail.name)}</h2>
            <div class=\"meta-block\">
              ${rating ? `<div class=\"rating-row\"><span class=\"rating-pill\">⭐ ${rating}</span><span style=\"color:var(--muted)\">${ratingsTotal} avaliações</span></div>` : `<div style=\"color:var(--muted)\">Sem avaliação</div>`}
            </div>
          </div>

          <div style=\"display:flex;flex-direction:column;align-items:flex-end;gap:8px\">
            <div style=\"font-size:13px;color:var(--muted)\">${websiteHtml}</div>
            <div style=\"font-size:13px;color:var(--muted)\">${detail.url ? `<a href=\"${detail.url}\" target=\"_blank\" rel=\"noopener noreferrer\"></a>` : ''}</div>
          </div>
        </div>

        <div class=\"info-row\">
          <div class=\"line\"><strong>Endereço:</strong> <span style=\"margin-left:6px\">${escapeHtml(detail.formatted_address || '')}</span></div>
          ${phoneHtml ? `<div class=\"line\"><strong>Telefone:</strong> <span style=\"margin-left:6px\">${phoneHtml}</span></div>` : ''}
          ${hoursHtml}
          ${distanceHtml}
        </div>

        <div class=\"profile-actions\">
          <button class=\"btn-action btn-primary\" id=\"modalRouteBtn\"><span class=\"material-icons\">directions</span> Traçar rota</button>
          <button class=\"btn-action btn-outline\" id=\"modalOpenMapsBtn\"><span class=\"material-icons\">map</span> Abrir no Maps</button>
          ${detail.website ? `<a class=\"btn-action btn-outline\" href=\"${detail.website}\" target=\"_blank\" rel=\"noopener noreferrer\"><span class=\"material-icons\">public</span> Site</a>` : ''}
          ${phoneHtml ? `<a class=\"btn-action btn-outline\" href=\"tel:${detail.formatted_phone_number.replace(/[^+\\d]/g,'')}\""><span class=\"material-icons\">call</span> Ligar</a>` : ''}
        </div>

        ${reviewsHtml}

        <div class=\"profile-footer\">
          <div>Dados do Google Places</div>
          <div style=\"font-size:12px;color:var(--muted)\">ID: ${escapeHtml(detail.place_id)}</div>
        </div>
      </div>
    `;

    modal.setAttribute('aria-hidden', 'false');

    // dentro de openProfile — depois de modal.setAttribute(...)

    setTimeout(() => {
      const firstFocusable = modal.querySelector('h2, button, a, input');
      if (firstFocusable) firstFocusable.focus();
      }, 40);

    // close
    const closeBtn = document.getElementById('closeModal');
    if (closeBtn) closeBtn.onclick = () => modal.setAttribute('aria-hidden','true');

    // modal Route => preview only
    const modalRouteBtn = document.getElementById('modalRouteBtn');
    if (modalRouteBtn) {
      modalRouteBtn.onclick = (ev) => {
        ev.preventDefault();
        if (detail.geometry && detail.geometry.location) {
          const dest = { lat: detail.geometry.location.lat(), lng: detail.geometry.location.lng() };
          traceRoutePreview(dest).catch(() => { alert('Não foi possível traçar a rota no mapa.'); });
        } else {
          alert('Destino inválido.');
        }
      };
    }

    // modal Open in Google Maps
    const modalOpenMapsBtn = document.getElementById('modalOpenMapsBtn');
    if (modalOpenMapsBtn) {
      modalOpenMapsBtn.onclick = (ev) => {
        ev.preventDefault();
        if (detail.geometry && detail.geometry.location) {
          const dest = { lat: detail.geometry.location.lat(), lng: detail.geometry.location.lng() };
          openInGoogleMaps(userLatLng, dest);
        }
      };
    }
  });
}

// route preview using DirectionsService
function traceRoutePreview(dest) {
  return new Promise((resolve, reject) => {
    if (!userLatLng) return reject(new Error('Localização do usuário desconhecida'));
    const req = {
      origin: new google.maps.LatLng(userLatLng.lat, userLatLng.lng),
      destination: new google.maps.LatLng(dest.lat, dest.lng),
      travelMode: google.maps.TravelMode.DRIVING,
      drivingOptions: { departureTime: new Date() }
    };
    directionsService.route(req, (res, st) => {
      if (st !== 'OK') return reject(new Error(st));
      directionsRenderer.setDirections(res);
      resolve(res);
    });
  });
}

// open external Google Maps with route
function openInGoogleMaps(origin, dest) {
  // omit origin param if unknown
  const originParam = (origin && origin.lat && origin.lng) ? `${origin.lat},${origin.lng}` : '';
  const originPart = originParam ? `&origin=${encodeURIComponent(originParam)}` : '';
  const url = `https://www.google.com/maps/dir/?api=1${originPart}&destination=${encodeURIComponent(dest.lat + ',' + dest.lng)}`;
  window.open(url, '_blank');
}

// helpers

// dedupe by place_id, keeping the closest occurrence (by _distance)

// dedupe by place_id, keeping the closest occurrence (by _distance)
function dedupePlacesById(arr) {
  const m = new Map();
  arr.forEach(p => {
    if (!p) return;
    const pid = p.place_id || (p._pos && isFinite(p._pos.lat) && isFinite(p._pos.lng) ? (p._pos.lat + ',' + p._pos.lng) : null);
    if (!pid) return;
    const existing = m.get(pid);
    if (!existing) {
      m.set(pid, p);
    } else {
      // keep the one with smaller _distance if available
      const dNew = (p._distance === undefined || !isFinite(p._distance)) ? Number.POSITIVE_INFINITY : p._distance;
      const dOld = (existing._distance === undefined || !isFinite(existing._distance)) ? Number.POSITIVE_INFINITY : existing._distance;
      if (dNew < dOld) m.set(pid, p);
    }
  });
  return Array.from(m.values());
}


function clearMarkers() { markers.forEach(m => m.setMap(null)); markers = []; }
function clearAll() {
  clearMarkers();
  if (userMarker) { userMarker.setMap(null); userMarker = null; }
  if (circle) { circle.setMap(null); circle = null; }
  try { directionsRenderer.set('directions', null); } catch(e){}
  const resultsEl = document.getElementById('results');
  if (resultsEl) resultsEl.innerHTML = '';
  const rc = document.getElementById('resultsCount');
  if (rc) rc.textContent = '';
  lastPlaces = [];
}
function haversine(a, b) {
  const toRad = d => d * Math.PI / 180; const R = 6371000;
  const dLat = toRad(b.lat - a.lat); const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2), sinDLon = Math.sin(dLon / 2);
  const aa = sinDLat * sinDLat + sinDLon * sinDLon * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"'`]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[s])); }

// defensive helper to add event listeners only if the element exists
function addListenerIfExists(id, event, cb) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, cb);
}

// make a select element cycle to next option on click (and keyboard Enter/Space)
// this version prevents the native dropdown from opening on mouse/touch so the click
// only advances the option.
function enableCyclicSelect(id) {
  const el = document.getElementById(id);
  if (!el) return;

  // Prevent native dropdown on mouse and touch interactions so a single click cycles options.
  // Keep keyboard support (Tab to focus + Enter/Space to cycle).
  el.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
  el.addEventListener('touchstart', (ev) => { ev.preventDefault(); ev.stopPropagation(); }, { passive: false });

  // click cycles
  el.addEventListener('click', (ev) => {
    try {
      const len = el.options.length;
      if (!len) return;
      el.selectedIndex = (el.selectedIndex + 1) % len;
      // trigger change
      const evt = new Event('change', { bubbles: true });
      el.dispatchEvent(evt);

      // special handlers
      if (id === 'distance') onDistanceChange();
      if (id === 'sortSelect') renderPlaces();
    } catch (e) { console.warn('cycle select fail', e); }
  });

  // keyboard support: Enter or Space will also cycle
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      el.click();
    }
  });
}

// compatibility shim: expose setOriginalResults in case other code expects it
window.setOriginalResults = function(results) {
  if (!Array.isArray(results)) return;
  lastPlaces = results.slice();
  renderPlaces();
};

// expose for debugging
window._petdex = { initMap, searchNearby, clearAll, tryLocateUser, openProfile, applyMapStyle, renderPlaces };