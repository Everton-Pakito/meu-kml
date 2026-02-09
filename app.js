let map, routeLayer, userMarker, recLayer;
let watchId = null;

let routeCoords = [];
let maneuvers = [];
let currentManeuver = 0;
let lastSpokenAt = 0;

let recording = false;
let recorded = []; // [{lat,lng,ts}]
let recDistance = 0;

let kmlSegments = [];     // [{ name, coords:[{lat,lng}...] }, ...]
let combinedCoords = [];  // concatenado

const el = (id) => document.getElementById(id);

// ===== Fora de rota + recálculo simples =====
const OFF_ROUTE_METERS = 60;        // distância máxima até a linha da rota (m)
const OFF_ROUTE_REPEAT_S = 15;      // repetir aviso (s)
let offRouteLastSpokenAt = 0;
let isOffRoute = false;

const API_BASE = "https://script.google.com/macros/s/AKfycbxF2tDy9zYROeY2juq8lPhEkjRKCgEZq46yUWLDSl3nMiGoCfHv-3pwZGeLSCUFjtFbLw/exec";

init();
function init(){
  initMap();

  // Centraliza no usuário ao abrir o app
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 16);
      if(!userMarker){
        userMarker = L.circleMarker([latitude, longitude], { radius:8 }).addTo(map);
      }
    });
  }

  initPWA();
  wireUI();
  // API fixa (Drive)
  refreshDriveList();

  setNext("", "");
}

function initMap(){
  map = L.map("map", { zoomControl: false }).setView([-23.5505, -46.6333], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap"
  }).addTo(map);
}

function initPWA(){
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js");
  }

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    el("btnInstall").style.display = "inline-block";
    el("btnInstall").onclick = async () => {
      el("btnInstall").style.display = "none";
      await deferredPrompt.prompt();
      deferredPrompt = null;
    };
  });
}

function wireUI(){

  el("btnRefresh").addEventListener("click", refreshDriveList);
  el("btnLoadKml").addEventListener("click", loadSelectedKml);

  el("btnUseSegment").addEventListener("click", () => {
    const v = el("segmentSelect").value;

    if(v === "__combined__"){
      if(!combinedCoords?.length){
        alert("Não há rota combinada disponível.");
        return;
      }
      useRouteCoords(combinedCoords, "Rota combinada");
      fitToCoords(combinedCoords);
      return;
    }

    const idx = parseInt(v, 10);
    const seg = kmlSegments[idx];
    if(!seg) return;

    useRouteCoords(seg.coords, seg.name);
    fitToCoords(seg.coords);
  });

  el("btnStartGPS").addEventListener("click", startGPS);
  el("btnStopGPS").addEventListener("click", stopGPS);

  el("btnRecStart").addEventListener("click", startRecording);
  el("btnRecStop").addEventListener("click", stopRecording);

  el("btnExportKml").addEventListener("click", exportRecordedKml);
  el("btnUploadKml").addEventListener("click", uploadRecordedKml);
}

/* ===== Google Drive via Apps Script ===== */
async function refreshDriveList(){
  const base = API_BASE;

  setNext("Atualizando lista do Drive…", "—");
  const url = `${base}?action=list`;

  const res = await fetch(url, { method:"GET" });
  if(!res.ok) throw new Error("Falha ao listar KMLs");
  const data = await res.json();

  const sel = el("kmlSelect");
  sel.innerHTML = "";
  (data.files || []).forEach(f => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name;
    sel.appendChild(opt);
  });

  // limpa estado da rota
  fillSegmentSelect([]);
  routeCoords = [];
  maneuvers = [];
  currentManeuver = 0;
  if(routeLayer){ routeLayer.remove(); routeLayer = null; }

  setNext((data.files?.length ? "Selecione um KML e carregue." : "Nenhum KML encontrado na pasta."), "—");
}

async function loadSelectedKml(){
  const base = API_BASE;
  const id = el("kmlSelect").value;
  if(!id) return;

  setNext("Baixando KML…", "—");
  const url = `${base}?action=get&id=${encodeURIComponent(id)}`;

  const res = await fetch(url, { method:"GET" });
  if(!res.ok) throw new Error("Falha ao baixar KML");
  const text = await res.text();

  loadKmlText(text);
}

function loadKmlText(kmlText){
  const xml = new DOMParser().parseFromString(kmlText, "text/xml");
  const geojson = toGeoJSON.kml(xml);

  kmlSegments = extractAllLineSegments(geojson);

  if(!kmlSegments.length){
    setNext("KML sem LineString.", "—");
    return;
  }

  // combinada (concatena na ordem do arquivo)
  combinedCoords = [];
  for(const s of kmlSegments){
    if(!combinedCoords.length){
      combinedCoords.push(...s.coords);
    }else{
      const last = combinedCoords[combinedCoords.length - 1];
      const first = s.coords[0];
      if(last && first && distanceMeters(last, first) < 1){
        combinedCoords.push(...s.coords.slice(1));
      }else{
        combinedCoords.push(...s.coords);
      }
    }
  }

  fillSegmentSelect(kmlSegments);

  // default: combinada
  useRouteCoords(combinedCoords, "Rota combinada");
  fitToCoords(combinedCoords);
}

function extractAllLineSegments(geojson){
  const segs = [];
  for(const f of (geojson.features || [])){
    const g = f?.geometry;
    if(!g) continue;

    const baseName =
      (f.properties && (f.properties.name || f.properties.title)) ||
      "Sem nome";

    if(g.type === "LineString"){
      segs.push({
        name: baseName,
        coords: g.coordinates.map(([lng, lat]) => ({ lat, lng }))
      });
    }

    if(g.type === "MultiLineString"){
      g.coordinates.forEach((lineCoords, idx) => {
        segs.push({
          name: `${baseName} (${idx+1})`,
          coords: lineCoords.map(([lng, lat]) => ({ lat, lng }))
        });
      });
    }
  }
  return segs.filter(s => Array.isArray(s.coords) && s.coords.length >= 2);
}

function fillSegmentSelect(segs){
  const sel = el("segmentSelect");
  sel.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "__combined__";
  opt0.textContent = segs.length ? `Combinada (${segs.length} segmentos)` : "Combinada";
  sel.appendChild(opt0);

  segs.forEach((s, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `${idx+1}. ${s.name} (${s.coords.length} pts)`;
    sel.appendChild(opt);
  });
}

function useRouteCoords(coords, label){
  routeCoords = coords || [];
  drawRoute(routeCoords);
  buildManeuvers(routeCoords);
  currentManeuver = 0;

  setNext(maneuvers[0]?.instr ?? `${label} carregada.`, "—");
}

function fitToCoords(coords){
  if(!coords || coords.length < 2) return;
  const bounds = L.latLngBounds(coords.map(p => [p.lat, p.lng]));
  map.fitBounds(bounds.pad(0.15));
}

/* ===== GPS + Navegação ===== */
function startGPS(){
  if(!navigator.geolocation){
    setGPS("Geolocalização não suportada.", true);
    return;
  }
  if(watchId) return;

  setGPS("Iniciando…", false);
  el("btnStartGPS").disabled = true;
  el("btnStopGPS").disabled = false;

  watchId = navigator.geolocation.watchPosition(
    onPosition,
    (err) => {
      setGPS("Erro: " + err.message, true);
      stopGPS();
    },
    { enableHighAccuracy:true, maximumAge:1000, timeout:15000 }
  );
}

function stopGPS(){
  if(watchId){
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  setGPS("Parado", false);
  el("btnStartGPS").disabled = false;
  el("btnStopGPS").disabled = true;
}

function onPosition(pos){
  const { latitude, longitude, speed } = pos.coords;
  const fix = { lat: latitude, lng: longitude };

  setGPS("Ativo", false);
  el("speed").textContent = speed != null ? `${(speed*3.6).toFixed(1)} km/h` : "—";

  if(!userMarker){
    userMarker = L.circleMarker([fix.lat, fix.lng], { radius:8 }).addTo(map);
  }else{
    userMarker.setLatLng([fix.lat, fix.lng]);
  }

  // gravação
  if(recording){
    appendRecordedPoint(fix);
    drawRecording();
  }

  const z = clamp(parseInt(el("zoom").value || "16", 10), 3, 20);
  map.setView([fix.lat, fix.lng], z, { animate:true });

  if(routeCoords.length < 2 || maneuvers.length === 0){
    setNext("Carregue um KML para navegar.", "—");
    return;
  }
  // ===== Fora de rota =====
  const dLine = distanceToRouteMeters(fix, routeCoords);
  if(dLine > OFF_ROUTE_METERS){
    isOffRoute = true;
    // recálculo simples (corta a rota a partir do ponto mais próximo)
    recalcSimpleFromPosition(fix);

    // aviso com repetição controlada
    const now = Date.now();
    if((now - offRouteLastSpokenAt) >= OFF_ROUTE_REPEAT_S * 1000){
      speak("Fora da rota. Recalculando.");
      offRouteLastSpokenAt = now;
    }

    // após recalcular, se ainda não houver rota suficiente, sai
    if(routeCoords.length < 2 || maneuvers.length === 0){
      setNext("Fora da rota.", "—");
      return;
    }
  }else{
    isOffRoute = false;
  }


  const advanceM = parseFloat(el("advanceMeters").value || "25");

  while(currentManeuver < maneuvers.length){
    const m = maneuvers[currentManeuver];
    const d = distanceMeters(fix, { lat:m.lat, lng:m.lng });
    if(d <= advanceM) { currentManeuver++; continue; }
    break;
  }

  if(currentManeuver >= maneuvers.length){
    setNext("Navegação concluída.", "—");
    return;
  }

  const m = maneuvers[currentManeuver];
  const dist = distanceMeters(fix, { lat:m.lat, lng:m.lng });
  setNext(m.instr, `${Math.round(dist)} m`);

  maybeSpeak(m.instr, dist);
}

function buildManeuvers(coords){
  maneuvers = [];
  if(!coords || coords.length < 3){
    if(coords && coords.length >= 2){
      const last = coords.at(-1);
      maneuvers.push({ idx: coords.length-1, lat:last.lat, lng:last.lng, instr:"Você chegou ao destino." });
    }
    return;
  }

  for(let i=1; i<coords.length-1; i++){
    const a = coords[i-1], b = coords[i], c = coords[i+1];
    const bin = bearing(a,b);
    const bout = bearing(b,c);
    const delta = smallestAngleDiff(bin, bout);

    if(Math.abs(delta) < 25) continue;
    maneuvers.push({ idx:i, lat:b.lat, lng:b.lng, instr: instructionFromDelta(delta) });
  }

  const last = coords.at(-1);
  maneuvers.push({ idx: coords.length-1, lat:last.lat, lng:last.lng, instr:"Você chegou ao destino." });
}

function instructionFromDelta(delta){
  const abs = Math.abs(delta);
  if(abs >= 120) return delta > 0 ? "Faça o retorno à direita." : "Faça o retorno à esquerda.";
  if(abs >= 60)  return delta > 0 ? "Vire à direita." : "Vire à esquerda.";
  return delta > 0 ? "Siga levemente à direita." : "Siga levemente à esquerda.";
}

function maybeSpeak(text, dist){
  const announceM = parseFloat(el("announceMeters").value || "120");
  const repeatS = parseFloat(el("repeatSeconds").value || "10");
  const now = Date.now();

  if(dist <= announceM && (now - lastSpokenAt) >= repeatS*1000){
    speak(textWithDistance(text, dist));
    lastSpokenAt = now;
  }
}

function speak(message){
  if(!("speechSynthesis" in window)) return;
  try{
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(message);
    u.lang = "pt-BR";
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  }catch(_){}
}

function textWithDistance(text, dist){
  if(text.includes("chegou")) return text;
  if(dist > 1000) return `${text} em ${Math.round(dist/1000)} quilômetros.`;
  return `${text} em ${Math.round(dist)} metros.`;
}

/* ===== Desenho no mapa ===== */
function drawRoute(coords){
  if(routeLayer) routeLayer.remove();
  routeLayer = null;
  if(!coords || coords.length < 2) return;
  routeLayer = L.polyline(coords.map(p => [p.lat, p.lng]), { weight:5 }).addTo(map);
}

function drawRecording(){
  if(recLayer) recLayer.remove();
  recLayer = null;
  if(recorded.length < 2) return;
  recLayer = L.polyline(recorded.map(p => [p.lat, p.lng]), { weight:4 }).addTo(map);
}

/* ===== Gravação ===== */
function startRecording(){
  recording = true;
  recorded = [];
  recDistance = 0;
  el("btnRecStart").disabled = true;
  el("btnRecStop").disabled = false;
  el("recPoints").textContent = "0";
  el("recDist").textContent = "0 m";
}

function stopRecording(){
  recording = false;
  el("btnRecStart").disabled = false;
  el("btnRecStop").disabled = true;
}

function appendRecordedPoint(fix){
  const ts = Date.now();
  const p = { lat: fix.lat, lng: fix.lng, ts };
  if(recorded.length){
    recDistance += distanceMeters(recorded[recorded.length-1], p);
  }
  recorded.push(p);
  el("recPoints").textContent = String(recorded.length);
  el("recDist").textContent = `${Math.round(recDistance)} m`;
}

function exportRecordedKml(){
  if(recorded.length < 2){
    alert("Grave ao menos 2 pontos.");
    return;
  }
  const name = (el("routeName").value.trim() || "Minha_Rota").replace(/[^\w\-]+/g, "_");
  const kml = buildKmlFromCoords(recorded, name);

  downloadText(`${name}.kml`, kml, "application/vnd.google-earth.kml+xml");
}

async function uploadRecordedKml(){
  const base = API_BASE;
  if(recorded.length < 2){
    alert("Grave ao menos 2 pontos.");
    return;
  }

  const name = (el("routeName").value.trim() || "Minha_Rota").replace(/[^\w\-]+/g, "_");
  const kml = buildKmlFromCoords(recorded, name);

  const url = `${base}?action=upload`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ filename: `${name}.kml`, content: kml })
  });

  if(!res.ok){
    const t = await res.text();
    alert("Falha no upload: " + t);
    return;
  }
  alert("Enviado para o Drive!");
  refreshDriveList();
}

/* ===== KML builder ===== */
function buildKmlFromCoords(points, name){
  const coords = points.map(p => `${p.lng},${p.lat},0`).join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
    <Placemark>
      <name>${escapeXml(name)}</name>
      <Style>
        <LineStyle><width>4</width></LineStyle>
      </Style>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
}

function downloadText(filename, text, mime){
  const blob = new Blob([text], { type:mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function escapeXml(s){
  return String(s).replace(/[<>&'"]/g, c => ({
    "<":"&lt;",
    ">":"&gt;",
    "&":"&amp;",
    "'":"&apos;",
    "\"":"&quot;"
  }[c]));
}

/* ===== UI ===== */
function setGPS(text, isError){
  const s = el("gpsStatus");
  s.textContent = text;
  s.style.opacity = isError ? "0.9" : "1";
}
function setNext(instr, dist){
  el("nextInstr").textContent = instr;
  el("nextDist").textContent = dist;
}

/* ===== Math/geo ===== */
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function toRad(d){ return d*Math.PI/180; }
function toDeg(r){ return r*180/Math.PI; }

function distanceMeters(p1,p2){
  const R = 6371000;
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const a = Math.sin(dLat/2)**2 +
    Math.cos(toRad(p1.lat))*Math.cos(toRad(p2.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function bearing(p1,p2){
  const φ1 = toRad(p1.lat), φ2 = toRad(p2.lat);
  const λ1 = toRad(p1.lng), λ2 = toRad(p2.lng);
  const y = Math.sin(λ2-λ1)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
  let θ = toDeg(Math.atan2(y,x));
  return (θ + 360) % 360;
}

function smallestAngleDiff(a,b){
  return ((b - a + 540) % 360) - 180;
}


document.getElementById("map").addEventListener("click", closeMenu);


// Distância (m) do ponto P até o segmento AB (lat/lng) usando aproximação equiretangular
function distancePointToSegmentMeters(p, a, b){
  // Converte para um plano local (equiretangular) centrado em p
  const R = 6371000;
  const φ = toRad(p.lat);
  const x = (lng) => toRad(lng - p.lng) * Math.cos(φ) * R;
  const y = (lat) => toRad(lat - p.lat) * R;

  const ax = x(a.lng), ay = y(a.lat);
  const bx = x(b.lng), by = y(b.lat);
  const px = 0, py = 0;

  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;

  const ab2 = abx*abx + aby*aby;
  if(ab2 === 0) return Math.sqrt(apx*apx + apy*apy);

  let t = (apx*abx + apy*aby) / ab2;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t*abx;
  const cy = ay + t*aby;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx*dx + dy*dy);
}

function distanceToRouteMeters(p, coords){
  if(!coords || coords.length < 2) return Infinity;
  let best = Infinity;
  for(let i=0; i<coords.length-1; i++){
    const d = distancePointToSegmentMeters(p, coords[i], coords[i+1]);
    if(d < best) best = d;
  }
  return best;
}

function closestRouteVertexIndex(p, coords){
  let bestIdx = 0;
  let best = Infinity;
  for(let i=0; i<coords.length; i++){
    const d = distanceMeters(p, coords[i]);
    if(d < best){
      best = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function recalcSimpleFromPosition(p){
  // Recalculo simples: pega o vértice mais próximo da rota e "corta" a rota a partir dele.
  const idx = closestRouteVertexIndex(p, routeCoords);
  const newCoords = routeCoords.slice(Math.max(0, idx));
  if(newCoords.length >= 2){
    useRouteCoords(newCoords, "Rota recalculada");
  }

  // Ajusta manobras: como useRouteCoords zera currentManeuver, ok.
  // Se preferir manter o desenho original, comente o useRouteCoords e só ajuste currentManeuver.
}


// ===== Menu lateral: botão mostrar/ocultar + auto-ocultar =====
const panel = document.querySelector(".panel");
const btnMenu = document.getElementById("btnMenu");
let menuTimer = null;

function openMenu(){
  panel.classList.add("open");
  document.body.classList.add("menu-open");
  resetMenuTimer();
}
function closeMenu(){
  panel.classList.remove("open");
  document.body.classList.remove("menu-open");
}
function toggleMenu(){
  if(panel.classList.contains("open")) closeMenu();
  else openMenu();
}
function resetMenuTimer(){
  if(menuTimer) clearTimeout(menuTimer);
  menuTimer = setTimeout(closeMenu, 5000);
}

btnMenu.addEventListener("click", (e)=>{
  e.stopPropagation();
  toggleMenu();
});

// Se clicar no mapa com o menu aberto, fecha
document.addEventListener("click", (e)=>{
  if(panel.classList.contains("open")){
    const insidePanel = panel.contains(e.target);
    const isButton = btnMenu.contains(e.target);
    if(!insidePanel && !isButton){
      closeMenu();
    }
  }
});

// Interação dentro do menu mantém aberto
panel.addEventListener("click", (e)=>{ e.stopPropagation(); resetMenuTimer(); });
panel.addEventListener("touchstart", (e)=>{ resetMenuTimer(); }, {passive:true});
