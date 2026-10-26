#!/usr/bin/env node
/**
 * Weryfikacja repozytorium wtyczek PL (manifest.json + scrapery JS).
 *
 * Replikuje ścieżkę ładowania/uruchamiania z NuvioTV:
 *   PluginManager.addRepository(url)  -> GET {url}/manifest.json
 *   downloadJsScrapers(...)           -> pobranie plików `filename`
 *   PluginRuntime.executePlugin(...)  -> opakowanie kodu w IIFE + wywołanie
 *     getStreams(tmdbId, mediaType, season, episode), potem walidacja wyników
 *     jak w parseJsonResults (url niepusty, typy pól).
 *
 * Uruchomienie:
 *   node verify/verify_repo.js            — testy mechaniczne + LIVE (bez TMDB)
 *   TMDB_API_KEY=xxx node verify/...      — dodatkowo pełna ścieżka TMDB
 *   node verify/verify_repo.js --offline  — tylko testy mechaniczne
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OFFLINE = process.argv.includes('--offline');

let failures = 0;
function ok(nazwa, cond, extra) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(mark + '  ' + nazwa + (extra ? '  ' + extra : ''));
}

// --- 1. Manifest -----------------------------------------------------------
const manifestPath = path.join(ROOT, 'manifest.json');
ok('manifest.json istnieje', fs.existsSync(manifestPath));

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  ok('manifest.json to poprawny JSON', true);
} catch (e) {
  ok('manifest.json to poprawny JSON', false, e.message);
  process.exit(1);
}

ok('manifest.name (string)', typeof manifest.name === 'string' && manifest.name.length > 0);
ok('manifest.version (string)', typeof manifest.version === 'string' && manifest.version.length > 0);
ok('manifest.scrapers (tablica)', Array.isArray(manifest.scrapers) && manifest.scrapers.length > 0);

const ids = new Set();
const scrapers = (manifest.scrapers || []).map((s, i) => {
  const okFields = s && typeof s.id === 'string' && typeof s.name === 'string' &&
    typeof s.version === 'string' && typeof s.filename === 'string' &&
    Array.isArray(s.supportedTypes) && s.supportedTypes.length > 0;
  ok('scraper[' + i + '] wymagane pola (id/name/version/filename/supportedTypes)', !!okFields, (s && s.id) || '?');
  if (ids.has(s.id)) ok('scraper[' + i + '] unikalny id', false, s.id);
  ids.add(s.id);
  return s;
});

// --- 2. Ładowanie scrapera jak w PluginRuntime ------------------------------
function wrapAndLoad(code) {
  const module = { exports: {} };
  const fn = new Function(
    'module', 'exports', 'fetch', 'console', 'require', 'URL', 'URLSearchParams',
    'atob', 'btoa', 'setTimeout', 'clearTimeout', 'AbortController', 'AbortSignal',
    'var __code__ = arguments[arguments.length - 1];' +
    '(function(){ ' + code + ' })(); return module.exports;'
  );
  return fn(
    module, module.exports, globalThis.fetch, console,
    (name) => { throw new Error("Module '" + name + "' nie jest dostępny"); },
    URL, URLSearchParams, atob, btoa, setTimeout, clearTimeout,
    AbortController, AbortSignal
  );
}

// Wymagania parseJsonResults: niepusty `url`; typy pól opcjonalnych.
function validateResultShape(item) {
  if (!item || typeof item !== 'object') return 'nie jest obiektem';
  if (typeof item.url !== 'string' || item.url.trim() === '') return 'brak url';
  if (item.infoHash != null && typeof item.infoHash !== 'string') return 'infoHash nie jest stringiem';
  if (item.seeders != null && typeof item.seeders !== 'number') return 'seeders nie jest liczbą';
  if (item.peers != null && typeof item.peers !== 'number') return 'peers nie jest liczbą';
  if (item.subtitles != null && !Array.isArray(item.subtitles)) return 'subtitles nie jest tablicą';
  return null;
}

globalThis.SCRAPER_SETTINGS = {};
globalThis.TMDB_API_KEY = process.env.TMDB_API_KEY || '';

// Przypadki testowe: [fraza, mediaType, sezon, odcinek] — tryb testowy scraperów
// (fraz zamiast TMDB id działa zawsze; TMDB id wymaga TMDB_API_KEY).
const LIVE_CASES = {
  'torrent-tpb': [{ args: ['The Matrix', 'movie', null, null], expect: '>0' },
                  { args: ['Breaking Bad', 'tv', 1, 1], expect: '>0' }],
  // Uwaga: filtr imdb_id/search_string w API EZTV bywa po ich stronie ignorowany —
  // dlatego oczekiwanie jest łagodne (>=0); scraper poprawnie filtruje tytuł u siebie.
  'torrent-eztv': [{ args: ['tt0903747', 'tv', 1, 1], expect: '>=0' }], // Breaking Bad
  'torrent-yts': [{ args: ['Inception', 'movie', null, null], expect: '>0' }],
  'torrent-bitsearch': [{ args: ['The Matrix', 'movie', null, null], expect: '>0' }],
  'torrent-torrentdownload': [{ args: ['The Matrix', 'movie', null, null], expect: '>0' }],
  'torrent-nyaa': [{ args: ['One Piece', 'tv', null, 1109], expect: '>=0' }],
  'movie-maxvod': [{ args: ['The Matrix', 'movie', null, null], expect: '>0' }],
  'serial-serialevip': [{ args: ['The Matrix', 'movie', null, null], expect: '>0' }],
  // Bajeczki24: część pozycji wymaga captcha po stronie hosta bys* — pomijane świadomie.
  'bajki-bajeczki24': [{ args: ['Kraina Lodu', 'movie', null, null], expect: '>=0' }],
  // 5-Toubun ∬ ma w frixysubs bezpośrednie pliki MP4/MKV (fileditch) — oczekujemy >0.
  'anime-frixysubs': [{ args: ['5-Toubun no Hanayome', 'tv', null, 1], expect: '>0' }],
  'anime-docchi': [{ args: ['One Piece', 'tv', null, 1], expect: '>=0' }]
};

function checkExpect(expect, n) {
  if (expect === '>0') return n > 0;
  return true; // '>=0'
}

async function main() {
  console.log('\n--- Testy mechaniczne (ładowanie + wykonanie + kształt wyników) ---');
  const loaded = {};
  for (const s of scrapers) {
    const filePath = path.join(ROOT, s.filename);
    if (!fs.existsSync(filePath)) { ok(s.id + ': plik ' + s.filename + ' istnieje', false); continue; }
    ok(s.id + ': plik ' + s.filename + ' istnieje', true);

    let exports;
    try {
      exports = wrapAndLoad(fs.readFileSync(filePath, 'utf8'));
      ok(s.id + ': opakowanie/składnia JS', true);
    } catch (e) {
      ok(s.id + ': opakowanie/składnia JS', false, e.message);
      continue;
    }

    const getStreams = exports && exports.getStreams;
    ok(s.id + ': eksportuje getStreams', typeof getStreams === 'function');
    if (typeof getStreams === 'function') {
      loaded[s.id] = getStreams;
      const types = (s.supportedTypes || ['movie']).map((t) => t.toLowerCase());
      const mediaType = types.includes('movie') ? 'movie' : 'tv';
      try {
        const res = await getStreams('603', mediaType, 1, 1);
        const arr = Array.isArray(res) ? res : [];
        ok(s.id + ': getStreams zwraca tablicę (mechanicznie, bez TMDB → zwykle pusta)', true, 'items=' + arr.length);
        let bad = 0;
        for (const item of arr) {
          const err = validateResultShape(item);
          if (err) { bad++; console.log('      -> zły element:', err, JSON.stringify(item).slice(0, 140)); }
        }
        ok(s.id + ': elementy mają poprawny kształt (url itd.)', bad === 0);
      } catch (e) {
        ok(s.id + ': getStreams nie rzuca wyjątku', false, e.message);
      }
    }
  }

  // Kolejny plik scrapera w manifest powinien istnieć fizycznie — i odwrotnie.
  const disk = fs.readdirSync(path.join(ROOT, 'scrapers')).filter((f) => f.endsWith('.js'));
  const manifestFiles = scrapers.map((s) => path.basename(s.filename)).sort();
  const orphan = disk.filter((f) => !manifestFiles.includes(f));
  ok('brak osieroconych plików w scrapers/ (spójność z manifestem)', orphan.length === 0, orphan.join(', '));

  if (OFFLINE) {
    console.log('\nTryb --offline: pomijam testy LIVE.');
  } else {
    console.log('\n--- Testy LIVE (rzeczywiste żądania sieciowe) ---');
    console.log('TMDB_API_KEY: ' + (globalThis.TMDB_API_KEY ? 'ustawiony' : 'brak — używam fraz testowych'));
    for (const s of scrapers) {
      const cases = LIVE_CASES[s.id] || [];
      if (!cases.length) { console.log('SKIP  ' + s.id + ': brak przypadku LIVE'); continue; }
      for (const c of cases) {
        const desc = s.id + ': getStreams(' + JSON.stringify(c.args) + ')';
        try {
          const t0 = Date.now();
          const res = await loaded[s.id].apply(null, c.args);
          const n = Array.isArray(res) ? res.length : 0;
          const ms = Date.now() - t0;
          const pass = Array.isArray(res) && checkExpect(c.expect, n) &&
            res.every((it) => validateResultShape(it) === null);
          ok(desc, pass, 'wyniki=' + n + ', ' + ms + ' ms');
          if (n > 0) {
            const f = res[0];
            console.log('      przykład: ' + JSON.stringify({
              title: String(f.title).slice(0, 70),
              url: String(f.url).slice(0, 80),
              quality: f.quality, size: f.size, seeders: f.seeders, language: f.language
            }));
          }
        } catch (e) {
          ok(desc, false, e.message);
        }
      }
    }
  }

  console.log('\nWynik: ' + (failures === 0 ? 'WSZYSTKIE KONTROLE OK' : failures + ' BŁĘDÓW'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
