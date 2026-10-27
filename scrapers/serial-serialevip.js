// UWAGA: plik WYGENEROWANY przez tools/build.js — nie edytuj ręcznie.
// Źródło: src/serial-serialevip.js.js + tools/kernel.js (wspólna warstwa HTTP).

// ============================================================================
// KERNEL PL — wspólna warstwa HTTP/UA/cookies/retry dla wszystkich scraperów.
// Kod wklejany na początku każdego scrapera przez tools/build.js (runtime Nuvio
// ładuje pliki osobno — brak importów międzyplikowych). Zgodny z polyfillem
// PluginRuntime.kt: fetch(OkHttp), brak setTimeout, brak prawdziwego cookie jar
// (jar realizowany tutaj na podstawie nagłówka set-cookie z odpowiedzi).
// ============================================================================
var __K = (function () {
    'use strict';

    var UA_POOL = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
    ];

    var jar = {}; // domena -> {nazwa: wartosc}

    function ua(i) { return UA_POOL[(typeof i === 'number' ? i : 0) % UA_POOL.length]; }

    function domainOf(url) {
        var m = String(url).match(/^https?:\/\/([^\/?#]+)/i);
        return m ? m[1].toLowerCase() : '';
    }

    function baseDomain(url) {
        var host = domainOf(url);
        var parts = host.split('.');
        return parts.length > 2 ? parts.slice(-2).join('.') : host;
    }

    // --- Cookie jar -----------------------------------------------------------
    // Runtime zwraca wszystkie nagłówki (w tym set-cookie, sklejone przecinkami).
    function harvestCookies(url, resp) {
        try {
            var raw = resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get('set-cookie') : null;
            if (!raw) return;
            // Oddziel kolejne ciasteczka: przecinek przed "nazwa=" (poza datami Expires).
            var cleaned = raw.replace(/,(\s*[A-Za-z0-9._-]+=[^;,]*)/g, '\u0001$1');
            var chunks = cleaned.split('\u0001');
            var dom = baseDomain(url);
            if (!jar[dom]) jar[dom] = {};
            for (var i = 0; i < chunks.length; i++) {
                var pair = chunks[i].split(';')[0].trim();
                var eq = pair.indexOf('=');
                if (eq <= 0) continue;
                var name = pair.slice(0, eq).trim();
                var val = pair.slice(eq + 1).trim();
                if (name && val && name !== 'expires' && name !== 'path' && name !== 'domain') {
                    jar[dom][name] = val;
                }
            }
        } catch (e) { /* jar jest opcjonalny */ }
    }

    function cookieHeader(url) {
        var dom = baseDomain(url);
        var bag = jar[dom] || {};
        var parts = [];
        for (var k in bag) { if (Object.prototype.hasOwnProperty.call(bag, k)) parts.push(k + '=' + bag[k]); }
        return parts.join('; ');
    }

    // --- Ustawienia scrapera (SCRAPER_SETTINGS z aplikacji) -------------------
    function settings(key, def) {
        var s = null;
        try { s = (typeof globalThis !== 'undefined') ? globalThis.SCRAPER_SETTINGS : null; } catch (e) { s = null; }
        if (s && typeof s === 'string') { try { s = JSON.parse(s); } catch (e2) { s = null; } }
        if (!s || typeof s !== 'object') return def;
        var v = s[key];
        return (v === undefined || v === null || v === '') ? def : v;
    }

    function log() {
        try { if (console && console.log) console.log.apply(console, arguments); } catch (e) {}
    }

    // --- Wykrywanie wyzwania Cloudflare ---------------------------------------
    function isChallenge(resp, body) {
        if (!resp) return false;
        if (resp.status === 403 || resp.status === 503 || resp.status === 429) {
            var server = '';
            try { server = (resp.headers.get('server') || '') + ' ' + (resp.headers.get('cf-mitigated') || ''); } catch (e) {}
            if (/cloudflare|challenge/i.test(server)) return true;
            var b = String(body || '').slice(0, 4000);
            if (/just a moment|challenge-platform|cf-browser-verification|cf_chl_|attention required/i.test(b)) return true;
        }
        return false;
    }

    // --- Główny klient HTTP ----------------------------------------------------
    // opts: { method, headers, body, redirect: 'follow'|'manual', tries }
    function http(url, opts) {
        opts = opts || {};
        var tries = opts.tries || 3;
        var method = (opts.method || 'GET').toUpperCase();

        function attempt(n) {
            var headers = Object.assign({}, opts.headers || {});
            if (!headers['User-Agent']) headers['User-Agent'] = ua(n - 1);
            if (!headers['Accept']) headers['Accept'] = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8';
            if (!headers['Accept-Language']) headers['Accept-Language'] = 'pl-PL,pl;q=0.9,en;q=0.6';
            // Client Hints — współczesne filtry antybotowe (Cloudflare itd.) flagują
            // żądania Chrome bez nagłówków Sec-Ch-Ua.
            var curUA = headers['User-Agent'];
            if (/Chrome\/(\d+)/.test(curUA) && !headers['Sec-Ch-Ua']) {
                var cv = (curUA.match(/Chrome\/(\d+)/) || [0, 131])[1];
                headers['Sec-Ch-Ua'] = '"Chromium";v="' + cv + '", "Not_A Brand";v="24"';
                headers['Sec-Ch-Ua-Mobile'] = /Android|Mobile/.test(curUA) ? '?1' : '?0';
                headers['Sec-Ch-Ua-Platform'] = /Android/.test(curUA) ? '"Android"' : (/Macintosh/.test(curUA) ? '"macOS"' : '"Windows"');
            }
            var ck = cookieHeader(url);
            if (ck && !headers['Cookie']) headers['Cookie'] = ck;

            var p = {
                method: method,
                headers: headers,
                redirect: opts.redirect === 'manual' ? 'manual' : 'follow'
            };
            if (opts.body !== undefined && opts.body !== null && method !== 'GET') p.body = opts.body;

            return fetch(url, p).then(function (resp) {
                return resp.text().then(function (body) {
                    harvestCookies(url, resp);
                    return { resp: resp, body: body };
                });
            }).then(function (r) {
                var cf = isChallenge(r.resp, r.body);
                if (cf && n < tries) {
                    log('[kernel] wyzwanie CF/blokada na ' + domainOf(url) + ' (status ' + r.resp.status + '), próba ' + (n + 1) + '/' + tries + ' z innym UA');
                    return attempt(n + 1);
                }
                if (!r.resp.ok && n < tries && (r.resp.status >= 502 && r.resp.status <= 504)) {
                    log('[kernel] błąd serwera ' + r.resp.status + ', próba ' + (n + 1) + '/' + tries);
                    return attempt(n + 1);
                }
                r.challenge = cf;
                return r;
            }).catch(function (err) {
                if (n < tries) {
                    log('[kernel] błąd sieci (' + (err && err.message ? err.message : err) + '), próba ' + (n + 1) + '/' + tries);
                    return attempt(n + 1);
                }
                throw err;
            });
        }
        return attempt(1);
    }

    function httpJSON(url, opts) {
        return http(url, opts).then(function (r) {
            if (!r.resp.ok) throw new Error('HTTP ' + r.resp.status + ' dla ' + url);
            try { return JSON.parse(r.body); }
            catch (e) { throw new Error('Niepoprawny JSON z ' + url); }
        });
    }

    // Rozwiązywanie łańcucha mirrorów: pierwszy, który odpowie poprawnie.
    function firstMirror(mirrors, makeRequest) {
        var i = 0;
        function next() {
            if (i >= mirrors.length) throw new Error('Wszystkie mirrory niedostępne: ' + mirrors.join(', '));
            var m = mirrors[i++];
            return makeRequest(m).catch(function (err) {
                log('[kernel] mirror nieudany: ' + m + ' (' + (err && err.message ? err.message : err) + ')');
                return next();
            });
        }
        return next();
    }

    // --- TMDB -------------------------------------------------------------------
    var tmdbCache = {};
    function tmdbGet(path) {
        var key = (typeof globalThis !== 'undefined' && globalThis.TMDB_API_KEY) ? globalThis.TMDB_API_KEY : '';
        if (!key) return Promise.resolve(null);
        var url = 'https://api.themoviedb.org/3' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + key;
        if (tmdbCache[url]) return Promise.resolve(tmdbCache[url]);
        return httpJSON(url).then(function (j) { tmdbCache[url] = j; return j; }).catch(function () { return null; });
    }

    // Rozwiązuje tmdbId do obiektu { numericId, imdb, titles[], year }.
    // tmdbId niebędący liczbą/tt-id jest traktowany jako fraza (tryb testowy).
    function resolveSubject(tmdbId, mediaType) {
        var id = String(tmdbId == null ? '' : tmdbId).trim();
        if (id && !/^\d+$/.test(id) && !/^tt\d+$/i.test(id)) {
            return Promise.resolve({ phrase: id, numericId: null, imdb: /^tt\d+$/i.test(id) ? id : null, titles: [id], year: null });
        }
        var isMovie = String(mediaType).toLowerCase() === 'movie';
        var kind = isMovie ? 'movie' : 'tv';
        if (/^tt\d+$/i.test(id)) {
            // Podane IMDB: znajdź przez find, potem pobierz tytuły.
            return tmdbGet('/find/' + id + '?external_source=imdb_id').then(function (f) {
                var hit = f && (f.movie_results && f.movie_results[0] || f.tv_results && f.tv_results[0]);
                if (!hit) return { phrase: null, numericId: null, imdb: id, titles: [id], year: null };
                var num = String(hit.id);
                return enrich(num, kind, id);
            });
        }
        return enrich(id, kind, null);
    }

    function enrich(num, kind, imdb) {
        return Promise.all([
            tmdbGet('/' + kind + '/' + num + '?language=en-US'),
            tmdbGet('/' + kind + '/' + num + '/alternative_titles'),
            tmdbGet('/' + kind + '/' + num + '/external_ids')
        ]).then(function (r) {
            var main = r[0], alts = r[1], ext = r[2];
            var titles = [];
            if (main) {
                if (main.title) titles.push(main.title);
                if (main.name) titles.push(main.name);
                if (main.original_title && titles.indexOf(main.original_title) < 0) titles.push(main.original_title);
                if (main.original_name && titles.indexOf(main.original_name) < 0) titles.push(main.original_name);
            }
            if (alts) {
                var list = (alts.results && alts.results[0] && alts.results[0].titles) || alts.titles || [];
                for (var i = 0; i < list.length && i < 6; i++) {
                    var t = list[i].title || list[i].name;
                    if (t && titles.indexOf(t) < 0) titles.push(t);
                }
            }
            var year = null;
            if (main) {
                var d = main.release_date || main.first_air_date || '';
                var m = String(d).match(/^(\d{4})/);
                if (m) year = m[1];
            }
            return { phrase: null, numericId: num ? String(num) : null, imdb: imdb || (ext && ext.imdb_id) || null, titles: titles, year: year };
        });
    }

    // --- Narzędzia tekstu / wyników ---------------------------------------------
    function normalize(s) {
        return String(s || '')
            .toLowerCase()
            // polskie znaki
            .replace(/[\u0105\u0104]/g, 'a').replace(/[\u0107\u0106]/g, 'c')
            .replace(/[\u0119\u0118]/g, 'e').replace(/[\u0142\u0141]/g, 'l')
            .replace(/[\u0144\u0143]/g, 'n').replace(/[\u00f3\u00d3]/g, 'o')
            .replace(/[\u015b\u015a]/g, 's').replace(/[\u017a\u017c\u0179]/g, 'z')
            // makrony (romaji japońskie: ō, ū, ā, ī, ē) — kluczowe dla tytułów anime
            .replace(/[\u014d\u014c\u00f4]/g, 'o').replace(/[\u016b\u016a\u00fb]/g, 'u')
            .replace(/[\u0101\u0100\u00e2]/g, 'a').replace(/[\u012b\u012a]/g, 'i')
            .replace(/[\u0113\u0112]/g, 'e')
            .replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function tokens(s) { return normalize(s).split(' ').filter(function (t) { return t.length > 1; }); }

    // Czy nazwa odpowiada frazie (pokrycie tokenów tytułu).
    function matchesTitle(name, titles, year) {
        var n = normalize(name);
        var best = 0;
        for (var i = 0; i < titles.length; i++) {
            var tt = tokens(titles[i]);
            if (!tt.length) continue;
            var hit = 0;
            for (var j = 0; j < tt.length; j++) { if (n.indexOf(tt[j]) >= 0) hit++; }
            var cov = hit / tt.length;
            if (cov > best) best = cov;
        }
        if (best < 0.6) return false;
        if (year && /\b(19|20)\d{2}\b/.test(n) && n.indexOf(String(year)) < 0) return false; // inny rok = zwykle remake/inna pozycja
        return true;
    }

    // Wykrywanie S/E w nazwie torrenta/odcinka.
    function seOf(name) {
        var n = String(name || '');
        var m = n.match(/\bS(\d{1,2})\s?[Ee](\d{1,3})\b/);
        if (m) return { s: parseInt(m[1], 10), e: parseInt(m[2], 10) };
        m = n.match(/\b(\d{1,2})x(\d{1,3})\b/);
        if (m) return { s: parseInt(m[1], 10), e: parseInt(m[2], 10) };
        m = n.match(/\bS(\d{1,2})\b/);
        if (m) return { s: parseInt(m[1], 10), e: null };
        return { s: null, e: null };
    }

    function seMatches(name, season, episode) {
        if (season == null && episode == null) return true;
        var se = seOf(name);
        if (season != null && se.s != null && se.s !== parseInt(season, 10)) return false;
        if (episode != null && se.e != null && se.e !== parseInt(episode, 10)) return false;
        return true;
    }

    function parseQuality(name) {
        var n = String(name || '').toUpperCase();
        if (/2160|4K|UHD/.test(n)) return '4K';
        if (/1080[pi]?/.test(n)) return '1080p';
        if (/720[pi]?/.test(n)) return '720p';
        if (/480[pi]?|DVD(Rip)?|XVID|DVDRIP/.test(n)) return '480p';
        if (/WEB-DL|WEBRip|WEB\b|HDTV|BLURAY|BDRIP|BRRIP/.test(n)) return null;
        return null;
    }

    function humanSize(bytes) {
        var b = parseInt(bytes, 10) || 0;
        if (b <= 0) return null;
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var v = b, i = 0;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return (Math.round(v * 10) / 10) + ' ' + units[i];
    }

    function magnet(hash, name) {
        return 'magnet:?xt=urn:btih:' + hash + '&dn=' + encodeURIComponent(name || '');
    }

    function cap(arr, n) { return (arr || []).slice(0, n || 60); }

    // --- Priorytety językowe (PL) ---------------------------------------------
    // 0 = polskie audio (lektor/dubbing), 1 = obce audio + polskie napisy,
    // 2 = reszta. Rozpoznaje konwencje release'owe PL (separator „ ", ".", "_",
    // "-", nawiasy), lektor AI, oznaczenia scenowe (PLDUB/PLSUB) i samodzielne
    // wielkie „PL" (np. „The.Matrix.1999.PL.720p.BluRay"); odrzuca domeny .pl.
    function plAudioInfo(name) {
        var n = String(name || '');
        var nl = n.toLowerCase();
        // audio PL
        var isLektor = /\blektor(?:[\s._-]*(?:pl|polski(?:i|a|ie)?|ai|eng))?\b|\bdi?lektor\b|\bldr[\s._-]*(?:pl|polsk)/.test(nl);
        var isDub = /\bdubbing(?:[\s._-]*(?:pl|polsk(?:i|a)?))?\b|\bdub(?:bing)?[\s._-]*pl\b|\bpl[\s._-]*dub(?:bing)?\b|\bpolsk(?:i|a)[\s._-]*dub|\bpolish[\s._-]*dub|\bpldub\b|\bai[\s._-]*dub\b/.test(nl);
        var isPolish = /\bpolish\b|\bpolsk(?:i|a|ie)\b|\bpolska[\s._-]*(?:wersja|polszczyzna)|\bwersja[\s._-]*(?:językowa[\s._-]*)?polsk|\bmi(?:edzy)?narrator\b|\bnarrator[\s._-]*pl\b/.test(nl);
        // samodzielne wielkie „PL" (konwencja scenowa: „1999.PL.720p") = zwykle audio PL;
        // wykluczamy tylko forme domenowe: „coś.pl" na końcu nazwy, przed „/" lub spacją
        // (np. „peb.pl", „www.torrentsite.pl download"). „PL" przed kropką i jakością
        // („1999.PL.720p") to zawsze znacznik języka.
        var isBarePL = /(^|[^a-zA-Z0-9])(?:PL|Pl|pl)(?![a-zA-Z0-9])/.test(n) &&
            !/[a-z0-9-]+\.(?:PL|Pl|pl)(?![a-zA-Z0-9])(?:$|\/|\s)/.test(n);
        // napisy PL
        var isPlSub = /\bnap(?:isy)?\.?[\s._-]*(?:pl|polskie)\b|\bpl[\s._-]*(?:sub(?:s|bed|beds|tit(?:le|les))?)\b|\bsub(?:s|bed)?[\s._-]*pl\b|\bnapisy\b(?=.*\b(?:pl|polsk))|\bpolish[\s._-]*sub(?:s|titles)?\b|\bplsub(?:bed|s)?\b|\bpl[\s._-]*nap(?:isy)?\b|\bsubtit(?:le|les)?[\s._-]*pl\b/.test(nl);
        // samodzielne „PL" w pobliżu słowa „napisy" (np. „Matrix.Pl.2003.NAPISY.720p") = napisy
        if (!isPlSub && isBarePL && /\bnap(?:isy)?\b/.test(nl)) isPlSub = true;
        // sygnatury polskich grup ripperskich sceny/p2p — wydania niemal zawsze
        // z polskim lektorem/dubbingiem lub polską ścieżką domyślną (-BiA, -BDC,
        // -VOiCE, -MHT, -mhteam, -gsk, -wst, -ksc, -sav, -N000B itd.)
        var plGroup = /-(?:BiA|BDC|VOiCE|VOICE|MHT(?:EAM)?|GSK|WST|KSC|SAV|GANDALF|EGAMI|G71|TIGER|NTB|NTb|N0+B|PTM|LTS|FaDDu)\b/.test(n);
        // wydania MULTi z tagiem polskiej grupy = ścieżka PL w kontenerze
        var multiPl = /\bMULT[iI]\b/.test(nl) && plGroup;
        // polska ścieżka audio opisana po „PL": PL.5.1 / PL.AC3 / PL.EAC3 / PL.DD(+) / PL.DTS / PL.TrueHD
        var plAudioTrack = /\bPL[\s._-]*(?:5\.1|7\.1|2\.0|AC3(?:\.?5\.1)?|E-?AC-?3|DD(?:\+|\.[0-9]|P[57]?\.[0-9])?|DTS(?:[-._]?(?:HD|X))?|TrueHD|FLAC|AAC|LPCM|PCM)\b/i.test(n);
        // odwrotnie: kodek audio … kończąca etykieta PL (np. „TrueHD.7.1.Atmos.PL")
        var plAudioTrack2 = /\b(?:TrueHD|Atmos|DD(?:P|\+)?|E-?AC-?3|AC3|DTS|FLAC|LPCM|PCM)[-._a-zA-Z0-9.]*\.(?:PL|Polish)(?![a-zA-Z0-9])(?![\s._-]*(?:sub|napisy))/i.test(n);
        var audio = null, subs = null;
        if (isLektor) audio = 'Lektor PL';
        else if (isDub) audio = 'Dubbing PL';
        else if (multiPl || plAudioTrack || plAudioTrack2) audio = 'Lektor PL'; // MULTi+grupa PL / PL.AC3 / kodek…PL
        else if (plGroup) audio = 'Lektor PL'; // sygnatura polskiej grupy sceny/p2p
        else if (isPolish || isBarePL) audio = 'Polski';
        if (isPlSub) subs = 'Napisy PL';
        var rank = 2;
        if (audio) rank = 0;
        else if (subs) rank = 1;
        // Przy audio PL i jednoczesnych napisach rozszerz etykietę.
        var language = audio ? (subs ? audio + ' + ' + subs : audio) : (subs || 'EN');
        // Bonus pewności (do wiarygodnej kolejności przy tym samym ranku):
        var confidence = (audio ? 10 : 0) + (plGroup ? 2 : 0) + (multiPl ? 3 : 0) + (subs ? 1 : 0);
        return { rank: rank, audio: audio, subs: subs, language: language, confidence: confidence, plGroup: plGroup };
    }

    // Stopień dla sortowania: najpierw rank językowy, potem seedery malejąco.
    function plRank(rel, seeders) {
        var r = parseInt(rel, 10); if (isNaN(r)) r = 2;
        var s = parseInt(seeders, 10); if (isNaN(s) || s < 0) s = 0;
        return r * 100000000 + s;
    }

    // Fabryka wyniku — gwarantuje kształt akceptowany przez parseJsonResults.
    function out(title, name, url, extra) {
        var e = extra || {};
        var r = {
            title: String(title || '').trim() || 'Bez tytułu',
            name: String(name || '').trim(),
            url: String(url || '').trim(),
            quality: e.quality || null,
            size: e.size || null,
            language: e.language || null,
            provider: e.provider || null,
            type: e.type || null,
            subtitles: []
        };
        if (e.seeders != null && !isNaN(parseInt(e.seeders, 10))) r.seeders = parseInt(e.seeders, 10);
        if (e.peers != null && !isNaN(parseInt(e.peers, 10))) r.peers = parseInt(e.peers, 10);
        if (e.infoHash) r.infoHash = String(e.infoHash);
        if (e.headers && typeof e.headers === 'object') r.headers = e.headers;
        return r;
    }

    function htmlDecode(s) {
        return String(s || '')
            .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
            .replace(/&#(\d+);/g, function (m, d) { try { return String.fromCharCode(parseInt(d, 10)); } catch (e) { return m; } });
    }

    function absUrl(href, base) {
        var h = String(href || '').trim();
        if (/^https?:\/\//i.test(h)) return h;
        if (h.indexOf('//') === 0) return 'https:' + h;
        var b = String(base).replace(/\/+$/, '');
        if (h.charAt(0) === '/') return b + h;
        return b + '/' + h;
    }

    return {
        UA_POOL: UA_POOL, ua: ua, http: http, httpJSON: httpJSON, firstMirror: firstMirror,
        settings: settings, log: log, isChallenge: isChallenge,
        tmdbGet: tmdbGet, resolveSubject: resolveSubject,
        normalize: normalize, tokens: tokens, matchesTitle: matchesTitle,
        seOf: seOf, seMatches: seMatches, parseQuality: parseQuality, humanSize: humanSize,
        magnet: magnet, cap: cap, out: out, htmlDecode: htmlDecode, absUrl: absUrl,
        plAudioInfo: plAudioInfo, plRank: plRank
    };
})();


// ============================================================================
// SILNIK RESOLVERÓW — porty algorytmów z ResolveURL/FanFilm (Python) na JS.
// Dołączany przez tools/build.js po kernelu; dostępny jako __R.<resolver>.
// Każdy resolver zwraca { url, headers? } albo null (czysto — bez rzucania).
// ============================================================================
var __R = (function () {
    'use strict';

    var K = __K;

    // --- CDA (ResolveURL CdaResolver) -----------------------------------------
    // 1) GET ebd.cda.pl/647x500/<id>/vfilm (Referer + UA),
    // 2) player_data (encje &quot;) -> video.qualities,
    // 3) GET ?wersja=<najlepsza> -> video.file,
    // 4) plik zakodowany -> cda_decode (usuwanie sufiksów + permutacja znaków).
    // Uwaga: CDA stoi za Cloudflare — bez cf_clearance w ustawieniach zwykle 403.
    function cdaDecode(a) {
        a = a.replace(/_XDDD|_CDA|_ADC|_CXD|_QWE|_Q5|_IKSDE/g, '');
        try { a = decodeURIComponent(a); } catch (e) { /* zostaw jak jest */ }
        var out = '';
        for (var i = 0; i < a.length; i++) {
            var c = a.charCodeAt(i);
            out += (c > 32 && c < 127) ? String.fromCharCode(33 + (c + 14) % 94) : a.charAt(i);
        }
        a = out;
        a = a.replace(/\.cda\.mp4/g, '');
        a = a.replace(/\.2cda\.pl/g, '.cda.pl').replace(/\.3cda\.pl/g, '.cda.pl');
        return 'https://' + a + '.mp4';
    }

    function parsePlayerData(html) {
        var m = html.match(/player_data=['"]([\s\S]+?)['"]\s*(?:tabindex|>)/);
        if (!m) m = html.match(/player_data=['"]([\s\S]+?)['"]/);
        if (!m) return null;
        var raw = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        try { return JSON.parse(raw); } catch (e) {
            try { return JSON.parse(decodeURIComponent(raw)); } catch (e2) { return null; }
        }
    }

    async function cda(embedUrl) {
        var cfCookie = K.settings('cf_clearance', null) || K.settings('cda_cf_clearance', null);
        var idMatch = String(embedUrl).match(/(?:cda\.pl)\/(?:\d+x\d+|video)\/([0-9a-zA-Z]+)/);
        if (!idMatch) return null;
        var id = idMatch[1];
        var webUrl = 'https://ebd.cda.pl/647x500/' + id + '/vfilm';
        var headers = { 'Referer': webUrl };
        if (cfCookie) headers['Cookie'] = 'cf_clearance=' + cfCookie;

        var r = await K.http(webUrl, { headers: headers });
        if (!r.resp.ok) { K.log('[cda] HTTP ' + r.resp.status + ' — potrzebny cf_clearance'); return null; }
        var data = parsePlayerData(r.body);
        if (!data || !data.video) return null;
        var quals = data.video.qualities ? Object.keys(data.video.qualities) : [];
        var best = null;
        for (var i = 0; i < quals.length; i++) {
            if (quals[i] === 'auto') continue;
            var qn = parseInt(quals[i], 10) || 0;
            if (!best || qn > (parseInt(best, 10) || 0)) best = quals[i];
        }
        if (best && quals.length) {
            var r2 = await K.http(webUrl + '?wersja=' + encodeURIComponent(best), { headers: headers });
            if (r2.resp.ok) {
                var d2 = parsePlayerData(r2.body);
                if (d2 && d2.video) data = d2;
            }
        }
        var vdata = data.video;
        var src = vdata.file || vdata.manifest_apple;
        if (!src) return null;
        var url = String(src).indexOf('http') === 0 ? String(src) : cdaDecode(String(src));
        var q = best ? (parseInt(best, 10) + 'p') : K.parseQuality(url);
        return { url: url, quality: q, headers: { 'User-Agent': K.ua(0), 'Referer': 'https://ebd.cda.pl/' } };
    }

    // --- Streamtape (ResolveURL StreamtapeResolver) ----------------------------
    // Ostatnie przypisanie ById('...') z literałów i substring(N); + &stream=1.
    async function streamtape(embedUrl) {
        try {
            var host = String(embedUrl).match(/^https?:\/\/([^\/]+)/);
            var headers = { 'Referer': host ? 'https://' + host[1] + '/' : 'https://streamtape.com/' };
            var r = await K.http(embedUrl, { headers: headers });
            if (!r.resp.ok) { K.log('[streamtape] HTTP ' + r.resp.status); return null; }
            var srcs = r.body.match(/ById\('.+?=\s*(["']\/\/[^;<]+)/g);
            if (!srcs || !srcs.length) return null;
            var last = srcs[srcs.length - 1].match(/(["'])(\/\/[^;<]+)/);
            var url = '', parts = last[2].split('+');
            for (var i = 0; i < parts.length; i++) {
                var lit = parts[i].match(/"([^"]*)/);
                if (!lit) continue;
                var off = 0;
                var subs = parts[i].match(/substring\((\d+)/g) || [];
                for (var j = 0; j < subs.length; j++) off += parseInt(subs[j].match(/\d+/)[0], 10);
                url += lit[1].slice(off);
            }
            if (!url) return null;
            url += '&stream=1';
            if (url.indexOf('//') === 0) url = 'https:' + url;
            return { url: url, quality: null, headers: headers };
        } catch (e) { K.log('[streamtape] ' + e.message); return null; }
    }

    // --- Sibnet (ResolveURL SibnetResolver) -------------------------------------
    async function sibnet(embedUrl) {
        try {
            var r = await K.http(embedUrl, { headers: { 'Referer': 'https://video.sibnet.ru/' } });
            if (!r.resp.ok) { K.log('[sibnet] HTTP ' + r.resp.status); return null; }
            var m = r.body.match(/src:\s*"([^"]+)/);
            if (!m) return null;
            var url = m[1];
            if (url.indexOf('//') === 0) url = 'https:' + url;
            else if (url.indexOf('/') === 0) url = 'https://video.sibnet.ru' + url;
            return { url: url, quality: K.parseQuality(url), headers: { 'Referer': 'https://video.sibnet.ru/' } };
        } catch (e) { K.log('[sibnet] ' + e.message); return null; }
    }

    // --- Vidmoly (ResolveURL VidmolyResolver) -----------------------------------
    // Trik z cookie cf_turnstile_demo_pass_<id>=1 + sources:[{file:'...'}].
    async function vidmoly(embedUrl) {
        try {
            var m = String(embedUrl).match(/embed-([0-9a-zA-Z]+)\.html/);
            if (!m) return null;
            var r = await K.http(embedUrl, {
                headers: {
                    'Referer': embedUrl,
                    'Cookie': 'cf_turnstile_demo_pass_' + m[1] + '=1'
                }
            });
            if (!r.resp.ok) { K.log('[vidmoly] HTTP ' + r.resp.status); return null; }
            var sm = r.body.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+)['"]/);
            if (!sm) return null;
            var url = sm[1];
            if (/\.mpd($|\?)/.test(url)) return null;
            if (url.indexOf('//') === 0) url = 'https:' + url;
            return { url: url, quality: K.parseQuality(url), headers: { 'Referer': embedUrl, 'User-Agent': K.ua(0) } };
        } catch (e) { K.log('[vidmoly] ' + e.message); return null; }
    }

    // --- Fsst (embedy fsst.online): jwplayer file:"[JAKOŚĆ]URL" ------------------
    async function fsst(embedUrl) {
        try {
            var r = await K.http(embedUrl, { headers: { 'Referer': embedUrl } });
            if (!r.resp.ok) { K.log('[fsst] HTTP ' + r.resp.status); return null; }
            var out = [];
            var re = /file\s*:\s*"\[([^\]]+)\](https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/g;
            var m;
            while ((m = re.exec(r.body)) !== null) {
                out.push({ label: m[1], url: m[2].replace(/\/$/, '') });
            }
            if (!out.length) return null;
            // wybierz najwyższą rozpoznawaną jakość
            var qn = function (l) {
                var mm = l.match(/(\d{3,4})p/i); return mm ? parseInt(mm[1], 10) : 0;
            };
            out.sort(function (a, b) { return qn(b.label) - qn(a.label); });
            var pick = out[0];
            return {
                url: pick.url,
                quality: K.parseQuality(pick.label) || K.parseQuality(pick.url),
                headers: { 'Referer': 'https://fsst.online/', 'User-Agent': K.ua(0) }
            };
        } catch (e) { K.log('[fsst] ' + e.message); return null; }
    }

    // --- Vidara (FanFilm serialevip): POST /api/stream {filecode} ---------------
    async function vidara(embedUrl) {
        var filecode = String(embedUrl).replace(/\/+$/, '').split('/').pop();
        if (!filecode) return null;
        var bases = ['https://vidara.to', 'https://vidara.so'];
        for (var i = 0; i < bases.length; i++) {
            try {
                var r = await K.http(bases[i] + '/api/stream', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Referer': bases[i] + '/e/' + filecode,
                        'Origin': bases[i]
                    },
                    body: JSON.stringify({ filecode: filecode })
                });
                if (!r.resp.ok) continue;
                var j = JSON.parse(r.body);
                if (j && j.streaming_url) {
                    return {
                        url: j.streaming_url,
                        quality: K.parseQuality(j.streaming_url),
                        headers: { 'Referer': bases[i] + '/', 'Origin': bases[i], 'User-Agent': K.ua(0) }
                    };
                }
            } catch (e) { K.log('[vidara] ' + bases[i] + ': ' + e.message); }
        }
        return null;
    }

    // --- Byse (ResolveURL ByseResolver) — ścieżka BEZ captcha -------------------
    // bysekoze/bysesukior/streamlyplayero/filemoon itd. Gdy serwer wymaga
    // captcha (ECDSA+Blake3+AES-GCM) — świadomie zwracamy null.
    function b64urlFromHex(hex) {
        var bin = '';
        for (var i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // Kompaktowy SHA-256 (do fingerprinta byse; działa w QuickJS i Node).
    function sha256(ascii) {
        function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
        var k = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
             0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
             0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
             0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
             0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
             0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
             0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
             0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
        var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        var w = new Array(64);
        function block(words) {
            for (var t = 0; t < 16; t++) w[t] = words[t];
            for (t = 16; t < 64; t++) {
                var s0 = rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
                var s1 = rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
                w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
            }
            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
            for (t = 0; t < 64; t++) {
                var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
                var ch = (e & f) ^ (~e & g);
                var t1 = (hh + S1 + ch + k[t] + w[t]) | 0;
                var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
                var mj = (a & b) ^ (a & c) ^ (b & c);
                var t2 = (S0 + mj) | 0;
                hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
            h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
        }
        var bytes = [];
        for (i = 0; i < ascii.length; i++) {
            var cc = ascii.charCodeAt(i);
            if (cc < 128) bytes.push(cc);
            else if (cc < 2048) bytes.push(192 | (cc >> 6), 128 | (cc & 63));
            else bytes.push(224 | (cc >> 12), 128 | ((cc >> 6) & 63), 128 | (cc & 63));
        }
        var bitLen = bytes.length * 8;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) bytes.push(0);
        for (i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
        for (i = 0; i < bytes.length; i += 64) {
            var words = [];
            for (var j = 0; j < 16; j++) {
                words[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
            }
            block(words);
        }
        return h.map(function (x) { var s = (x >>> 0).toString(16); while (s.length < 8) s = '0' + s; return s; }).join('');
    }

    function byseFingerprint() {
        function rndHex(n) {
            var s = '';
            for (var i = 0; i < n * 2; i++) s += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16));
            return s;
        }
        var viewerId = rndHex(16), deviceId = rndHex(16);
        var conf = (0.83 + Math.random() * 0.11).toFixed(2);
        var tdata = { viewer_id: viewerId, device_id: deviceId, confidence: parseFloat(conf) };
        var body = JSON.stringify(tdata);
        var sig = b64urlFromHex(sha256(body));
        var token = b64urlFromHex(sha256(body)); // zbuduj jak w oryginale: b64(json).b64(sha256(b64(json)))
        var b64body = btoa(body).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        token = b64body + '.' + b64urlFromHex(sha256(b64body));
        return { fingerprint: { viewer_id: viewerId, device_id: deviceId, confidence: parseFloat(conf), token: token } };
    }

    var BYSE_DOMAINS = /byse(?:koze|sukior|jikuar|fujedu|dikamoum|buho|wihe|lapuix|vepoin|zoxexe|sayeveum|tayico|zejataos|vepoin)?\.(?:com|sx)|filemoon\.(?:sx|to|in|link|wf|eu|art|nl)|streamlyplayero?\.online|cinegrab\.com|moonmov\.pro|moflix-stream\.link/i;

    async function byse(embedUrl, parentReferer) {
        try {
            var m = String(embedUrl).match(/^https?:\/\/([^\/]+)\/(?:e|d|download)?\/?([0-9a-zA-Z]+)/);
            if (!m || !BYSE_DOMAINS.test(m[1])) return null;
            var host = m[1].replace(/^www\./, '');
            if (/boosteradx|byse\.sx|streamlyplayer\.online/i.test(host)) host = 'streamlyplayero.online';
            var ref = 'https://' + host + '/';
            var topRef = ref.slice(0, -1);
            var headers = { 'Referer': topRef, 'Origin': topRef };
            if (parentReferer) {
                var parent = String(parentReferer).match(/^https?:\/\/([^\/]+)/);
                if (parent) {
                    headers['X-Embed-Origin'] = parent[1].replace(/^www\./, '');
                    headers['X-Embed-Referer'] = parentReferer;
                }
            }
            var id = m[2];

            // details; przy 404 przejście na wariant embed/
            var d = await K.httpJSON(topRef + '/api/videos/' + id + '/details', { headers: headers }).catch(function () { return null; });
            if (!d) {
                d = await K.httpJSON(topRef + '/api/videos/' + id + '/embed/details', { headers: headers }).catch(function () { return null; });
                if (!d) { K.log('[byse] details niedostępne'); return null; }
            }
            // ramka osadzenia zmienia bazę dla kolejnych wywołań API
            if (d && d.embed_frame_url) {
                var em = String(d.embed_frame_url).match(/^https?:\/\/[^\/]+/);
                if (em) {
                    headers['X-Embed-Parent'] = topRef;
                    headers['Referer'] = em[0];
                    headers['Origin'] = em[0];
                    topRef = em[0];
                    ref = em[0] + '/';
                }
            }

            var s = await K.httpJSON(topRef + '/api/videos/' + id + '/settings', { headers: headers }).catch(function () { return null; });
            if (!s) { K.log('[byse] brak settings'); return null; }
            if (s.captcha_required) { K.log('[byse] wymagana captcha — pomijam (poza zakresem)'); return null; }

            var pb = await K.http(topRef + '/api/videos/' + id + '/playback', {
                method: 'POST',
                headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
                body: JSON.stringify(byseFingerprint())
            });
            if (!pb.resp.ok) { K.log('[byse] playback HTTP ' + pb.resp.status); return null; }
            var data = JSON.parse(pb.body);
            var sources = data && data.sources;
            if (sources && sources.length) {
                var pick = sources[0];
                for (var i = 1; i < sources.length; i++) {
                    if (parseInt(sources[i].label, 10) > parseInt(pick.label, 10)) pick = sources[i];
                }
                var uri = pick.url;
                if (uri.indexOf('/') === 0) uri = topRef + uri;
                return { url: uri, quality: K.parseQuality(String(pick.label)), headers: headers };
            }
            if (data && data.playback) { K.log('[byse] playback zaszyfrowany (AES-GCM) — fallback unpacker'); return filemoonUnpack(embedUrl); }
            // brak źródeł — ostatnia deska ratunku: unpack strony osadzenia
            return filemoonUnpack(embedUrl);
        } catch (e) { K.log('[byse] ' + e.message); return null; }
    }

    // --- Veev (veev.to / poophq / doods — port z FanFilm serialevip.py) ---------
    // LZW dekodowanie ciasteczek „fc" z osadzenia -> /dl?op=player_api&cmd=gi
    // -> dekodowanie URL-a z dv[0].s (unhexlify + odwracanie wg tablicy ch).
    function veevLzwDecode(etext) {
        var result = [], lut = {}, n = 256;
        var c = etext.charAt(0);
        result.push(c);
        for (var i = 1; i < etext.length; i++) {
            var ch = etext.charAt(i);
            var code = etext.charCodeAt(i);
            var nc = (code < 256) ? ch : (Object.prototype.hasOwnProperty.call(lut, code) ? lut[code] : c + c.charAt(0));
            result.push(nc);
            lut[n] = c + nc.charAt(0);
            n += 1;
            c = nc;
        }
        return result.join('');
    }

    function veevJsInt(x) { var v = parseInt(x, 10); return isNaN(v) ? 0 : v; }

    function veevBuildArray(encoded) {
        var d = [], c = encoded.split('');
        var count = veevJsInt(c.shift());
        while (count) {
            var arr = [];
            for (var i = 0; i < count; i++) arr.unshift(veevJsInt(c.shift()));
            d.push(arr);
            count = veevJsInt(c.shift());
        }
        return d;
    }

    function veevUnhex(h) {
        var out = '';
        for (var i = 0; i < h.length; i += 2) {
            out += String.fromCharCode(parseInt(h.substr(i, 2), 16));
        }
        // decodeURIComponent(escape(...)) dla UTF-8:
        try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
    }

    function veevDecodeUrl(etext, tarray) {
        var ds = etext;
        for (var i = 0; i < tarray.length; i++) {
            var t = tarray[i];
            if (t === 1) ds = ds.split('').reverse().join('');
            ds = veevUnhex(ds);
            ds = ds.replace(/dXRmOA==/g, '');
        }
        return ds;
    }

    async function veev(embedUrl) {
        try {
            var r = await K.http(embedUrl, { headers: { 'Referer': embedUrl } });
            if (!r.resp.ok) { K.log('[veev] HTTP ' + r.resp.status); return null; }
            var finalUrl = r.resp.url || embedUrl;
            var mediaId = finalUrl.replace(/\/+$/, '').split('/').pop();
            var items = [];
            var re = /[\.\s'](?:fc|_vvto\[[^\]]*)(?:['\]]*)?\s*[:=]\s*['"]([^'"]+)/g;
            var m;
            while ((m = re.exec(r.body)) !== null) items.push(m[1]);
            for (var i = items.length - 1; i >= 0; i--) {
                var cand = items[i];
                var ch = veevLzwDecode(cand);
                if (ch === cand) continue;
                var dl = finalUrl.replace(/\/[^\/]*$/, '') + '/dl?op=player_api&cmd=gi&file_code=' +
                    encodeURIComponent(mediaId) + '&ch=' + encodeURIComponent(ch) + '&ie=1';
                var dr = await K.http(dl, { headers: { 'Referer': embedUrl } });
                if (!dr.resp.ok) continue;
                var j;
                try { j = JSON.parse(dr.body); } catch (e2) { continue; }
                var file = j && j.file;
                if (file && file.file_status === 'OK' && file.dv && file.dv[0] && file.dv[0].s) {
                    var s = veevDecodeUrl(veevLzwDecode(file.dv[0].s), veevBuildArray(ch)[0]);
                    if (s) return { url: s, quality: K.parseQuality(s), headers: { 'Referer': embedUrl, 'User-Agent': K.ua(0) } };
                }
                return null;
            }
            return null;
        } catch (e) { K.log('[veev] ' + e.message); return null; }
    }

    // --- Unpacker Dean Edwardsa (eval(function(p,a,c,k,e,d)...)) -----------------
    // Odkodowanie zaciemnionych skryptów hostów wideo (filemoon i pokrewne).
    function unpackPacked(text) {
        var re = /eval\s*\(\s*function\s*\(([^)]*)\)\s*\{[\s\S]*?\}\s*\(\s*'(.*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\s*\(\s*'(\|)'\s*\)/;
        var m = text.match(re);
        if (!m) return text;
        var payload = m[2], radix = parseInt(m[3], 10), count = parseInt(m[4], 10);
        var keys = m[5].split('|');
        var unpad = function (s, r) {
            var out = '';
            var v = parseInt(s, r);
            if (isNaN(v)) return s;
            var digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, r);
            while (v > 0) { out = digits.charAt(v % r) + out; v = Math.floor(v / r); }
            return out || '0';
        };
        for (var i = count - 1; i >= 0; i--) {
            var token = keys[i] || '';
            if (!token) continue;
            var pat = new RegExp('\\b' + unpad(i.toString(radix), radix) + '\\b', 'g');
            payload = payload.replace(pat, token);
        }
        return payload;
    }

    // Fallback dla hostów typu filemoon: jeśli API byse zawiedzie, szukamy
    // zapakowanego skryptu i wyciągamy plik m3u8/mp4.
    async function filemoonUnpack(embedUrl) {
        try {
            var r = await K.http(embedUrl, { headers: { 'Referer': embedUrl } });
            if (!r.resp.ok) return null;
            var html = unpackPacked(r.body);
            var m = html.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/) ||
                    html.match(/src\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/);
            if (m) {
                var u = m[1];
                if (u.indexOf('//') === 0) u = 'https:' + u;
                return { url: u, quality: K.parseQuality(u), headers: { 'Referer': embedUrl, 'User-Agent': K.ua(0) } };
            }
            return null;
        } catch (e) { K.log('[filemoon] ' + e.message); return null; }
    }

    // --- Doodstream (ResolveURL DoodstreamResolver; dood.* / ds2play / doods.pro…) --
    // 1) GET /d/<id> (z follow), 2) iframe lub /d/→/e/, 3) „dsplayer.hotkeys …
    // makePlay … return” → pass_md5 + token, 4) GET pass_md5 → URL bezpośredni
    // (cloudflarestorage) albo treść + 10 losowych znaków + token + timestamp.
    async function dood(embedUrl) {
        try {
            var hm = String(embedUrl).match(/^https?:\/\/([^\/]+)/);
            if (!hm) return null;
            var host = hm[1];
            var idm = embedUrl.match(/(?:\/d\/|\/e\/|videoid=)([0-9a-zA-Z]+)/);
            if (!idm) return null;
            var known = /dood[a-z0-9.]*|ds2play\.com|ds2video\.com|doods\.pro|d0o0d\.com|do0od\.com|dooood\.com|myvidplay\.com|playmogo\.com/i;
            if (!known.test(host)) host = 'playmogo.com';
            var webUrl = 'https://' + host + '/d/' + idm[1];
            var r1 = await K.http(webUrl);
            if (!r1.resp.ok) { K.log('[dood] HTTP ' + r1.resp.status); return null; }
            var finalUrl = r1.resp.url || webUrl;
            var host2 = (finalUrl.match(/^https?:\/\/([^\/]+)/) || [0, host])[1];
            if (host2 !== host) webUrl = 'https://' + host2 + '/d/' + idm[1];
            var html = r1.body;
            var url2 = webUrl;
            var im = html.match(/<iframe\s*src="([^"]+)/);
            if (im) {
                url2 = /^https?:\/\//i.test(im[1]) ? im[1] : ('https://' + host2 + ('' + im[1]).charAt(0) === '/' ? 'https://' + host2 + im[1] : im[1]);
                // uproszczenie: urljoin ręcznie
                if (!/^https?:\/\//i.test(im[1])) url2 = 'https://' + host2 + (im[1].charAt(0) === '/' ? '' : '/') + im[1];
                var r2 = await K.http(url2, { headers: { 'Referer': webUrl } });
                if (!r2.resp.ok) return null;
                html = r2.body;
                finalUrl = r2.resp.url || url2;
            } else {
                var e2 = webUrl.replace('/d/', '/e/');
                var r3 = await K.http(e2, { headers: { 'Referer': webUrl } });
                if (!r3.resp.ok) return null;
                html = r3.body;
                finalUrl = r3.resp.url || e2;
            }
            var m = html.match(/dsplayer\.hotkeys[^']+'([^']+)[\s\S]+?function\s+makePlay[\s\S]+?return[^?]+([^"]+)/);
            if (!m) { K.log('[dood] brak wzorca hotkeys'); return null; }
            var token = m[2];
            var passUrl = /^https?:\/\//i.test(m[1]) ? m[1] : (finalUrl.replace(/\/[^\/]*$/, '') + '/' + m[1].replace(/^\//, ''));
            var r4 = await K.http(passUrl, { headers: { 'Referer': finalUrl } });
            if (!r4.resp.ok) return null;
            var body = String(r4.body).trim();
            var vidSrc;
            if (body.indexOf('cloudflarestorage.') >= 0) {
                vidSrc = body;
            } else {
                var ab = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                var rnd = '';
                for (var i = 0; i < 10; i++) rnd += ab.charAt(Math.floor(Math.random() * ab.length));
                vidSrc = body + rnd + token + Date.now();
            }
            if (vidSrc.indexOf('//') === 0) vidSrc = 'https:' + vidSrc;
            return { url: vidSrc, quality: K.parseQuality(vidSrc), headers: { 'Referer': 'https://' + host2 + '/', 'User-Agent': K.ua(0) } };
        } catch (e) { K.log('[dood] ' + e.message); return null; }
    }

    // --- Router po domenie -------------------------------------------------------
    function hostOf(u) { var m = String(u).match(/^https?:\/\/([^\/?#]+)/); return m ? m[1].toLowerCase() : ''; }

    async function auto(embedUrl, parentReferer) {
        var h = hostOf(embedUrl);
        if (/cda\.pl/.test(h)) return cda(embedUrl);
        if (/streamtape|strtape|strcloud|shavetape|scloud\.online|streamadblock/i.test(h)) return streamtape(embedUrl);
        if (/sibnet\.ru/.test(h)) return sibnet(embedUrl);
        if (/vidmoly/.test(h)) return vidmoly(embedUrl);
        if (/fsst\.online|fsst/.test(h)) return fsst(embedUrl);
        if (/vidara\.(to|so)/.test(h)) return vidara(embedUrl);
        if (/veev\.to|poophq|doods\.pro/.test(h)) return veev(embedUrl);
        if (/dood[a-z0-9.]*\.(?:com|to|so|cx|la|ws|sh|co|pm|wf|re|yt|stream|watch)|ds2play\.com|ds2video\.com|d0o0d\.com|do0od\.com|dooood\.com|myvidplay\.com|playmogo\.com/i.test(h)) return dood(embedUrl);
        if (BYSE_DOMAINS.test(h)) return byse(embedUrl, parentReferer);
        K.log('[auto] brak resolvera dla ' + h);
        return null;
    }

    return {
        cda: cda, streamtape: streamtape, sibnet: sibnet, vidmoly: vidmoly,
        fsst: fsst, vidara: vidara, veev: veev, dood: dood, byse: byse, filemoonUnpack: filemoonUnpack, unpackPacked: unpackPacked, auto: auto, sha256: sha256
    };
})();


// ================= LOGIKA SCRAPERÓW: serial-serialevip =================
// Seriale.vip — polskie seriale i filmy (port z FanFilm serialevip.py,
// ZWERIFYKOWANE live): DLE search -> strona wpisu z news_id -> POST
// /engine/ajax/controller.php?mod=playlists (news_id, xfield=pl) -> lista
// torów (LEKTOR itd.) z embedami fsst.online / vidara.so -> resolvery
// (fsst: jwplayer file:"[Q]URL", vidara: POST /api/stream) -> pliki bezpośrednie.
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];
        var isMovie = String(mediaType).toLowerCase() === 'movie';
        var base = 'https://seriale.vip';

        // 1. Wyszukiwanie DLE.
        var hits = [];
        var queries = sub.phrase ? [sub.phrase] : titles.slice(0, 3);
        for (var qi = 0; qi < queries.length && !hits.length; qi++) {
            try {
                var r = await K.http(base + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(queries[qi]));
                if (!r.resp.ok) continue;
                var re = /href="https:\/\/seriale\.vip\/(films|serials)\/(\d+)-([a-z0-9-]+)\.html"/g;
                var m;
                while ((m = re.exec(r.body)) !== null && hits.length < 8) {
                    var slug = m[3];
                    var clean = slug.replace(/-online$/, '').replace(/-(\d{4})$/, ' $1');
                    hits.push({ newsId: m[2], slug: slug, path: m[1] + '/' + m[2] + '-' + m[3] + '.html', kind: m[1], title: K.htmlDecode(clean) });
                }
            } catch (e) { K.log('[serialevip] szukanie: ' + e.message); }
        }
        if (!hits.length) return [];

        // 2. Dopasowanie tytułu/roku; filmy z /films/, seriale z /serials/.
        var best = null;
        for (var i = 0; i < hits.length; i++) {
            var h = hits[i];
            if (isMovie && h.kind !== 'films') continue;
            if (!isMovie && h.kind !== 'serials') continue;
            var slugYear = (h.slug.match(/-(\d{4})$/) || [])[1];
            var ok = sub.phrase ? true : K.matchesTitle(h.title, titles, sub.year);
            if (ok && (!sub.year || !slugYear || slugYear === String(sub.year))) { best = h; break; }
            if (ok && !best) best = h;
        }
        if (!best) return [];

        // 3. news_id ze strony wpisu + playlista.
        var page = await K.http(base + '/' + best.path);
        if (!page.resp.ok) { K.log('[serialevip] strona HTTP ' + page.resp.status); return []; }
        var nm = page.body.match(/news_id\s*=\s*"?(\d+)"?/) || page.body.match(/news-id="(\d+)"/);
        if (!nm) { K.log('[serialevip] brak news_id'); return []; }
        var newsId = nm[1];
        var plst = await K.http(base + '/engine/ajax/controller.php?mod=playlists', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': page.resp.url || base + '/',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: 'news_id=' + encodeURIComponent(newsId) + '&xfield=pl'
        });
        if (!plst.resp.ok) { K.log('[serialevip] playlists HTTP ' + plst.resp.status); return []; }
        var pj;
        try { pj = JSON.parse(plst.body); } catch (e) { return []; }
        var html = (pj && pj.response) || '';
        if (!html) return [];

        // 4. Tory (data-id="X_Y_Z" + etykieta LEKTOR/DUBBING...) i wideo (data-file).
        // Serial: elementy wideo data-id="X_Y_Z_<sezon0>" i etykieta „<N> odcinek".
        var trackLang = {}; // prefix "X_Y" -> etykieta językowa
        var ti = /<li data-id="([^"]+)">([^<]+)<\/li>/g;
        var tm;
        while ((tm = ti.exec(html)) !== null) {
            var parts = tm[1].split('_');
            if (parts.length === 3) trackLang[parts[0] + '_' + parts[1]] = tm[2].trim().toUpperCase();
        }
        var vi = /<li data-file="([^"]+)" data-id="([^"]+)">([^<]*)<\/li>/g;
        var vm;
        var embeds = [];
        while ((vm = vi.exec(html)) !== null) {
            var fileId = vm[2].split('_');
            var label = vm[3].trim();
            if (fileId.length === 2) {
                // film: etykieta elementu wideo to język (np. „LEKTOR"), tor X_Y to dostawca
                embeds.push({ embed: vm[1], prefix: vm[2], langLabel: label, label: label, epNum: null, seasonIdx: null });
            } else if (fileId.length === 4) {
                // serial: X_Y = tor (język/dostawca), Z = provider, ostatni = sezon (0-based)
                var em = label.match(/(\d+)\s*odcinek/i);
                embeds.push({
                    embed: vm[1], prefix: fileId[0] + '_' + fileId[1],
                    langLabel: trackLang[fileId[0] + '_' + fileId[1]] || '',
                    label: label,
                    epNum: em ? parseInt(em[1], 10) : null,
                    seasonIdx: parseInt(fileId[3], 10)
                });
            }
        }
        if (!embeds.length) return [];

        // 5. Filtr sezon/odcinek (serial), preferencja LEKTOR -> reszta.
        var out = [];
        for (var e = 0; e < embeds.length && out.length < 8; e++) {
            var it = embeds[e];
            if (!isMovie) {
                if (season != null && it.seasonIdx != null && it.seasonIdx !== parseInt(season, 10) - 1) continue;
                if (episode != null && it.epNum != null && it.epNum !== parseInt(episode, 10)) continue;
            }
            var isLektor = /LEKTOR|LITERAK|DUBBING/.test(it.langLabel);
            var resolved = null;
            var hst = (it.embed.match(/^https?:\/\/([^\/]+)/) || [''])[1] || '';
            if (/fsst/.test(hst)) resolved = await __R.fsst(it.embed);
            else if (/vidara/.test(hst)) resolved = await __R.vidara(it.embed);
            else if (/veev\.to|poophq|doods/.test(hst)) resolved = await __R.veev(it.embed);
            else { K.log('[serialevip] pomijam host: ' + hst); continue; }
            if (!resolved) continue;

            var pli = K.plAudioInfo(isLektor ? 'Lektor PL' : (it.langLabel || 'EN'));
            out.push({
                rank: pli.rank,
                r: K.out(
                    (sub.phrase || titles[0] || best.title) +
                    (!isMovie && it.epNum != null ? ' — odc. ' + it.epNum : '') +
                    (resolved.quality ? ' [' + resolved.quality + ']' : '') +
                    (it.langLabel ? ' — ' + it.langLabel : ''),
                    'SerialeVIP', resolved.url,
                    {
                        quality: resolved.quality,
                        language: pli.language,
                        provider: 'SerialeVIP',
                        type: 'direct',
                        headers: resolved.headers
                    }
                )
            });
        }
        out.sort(function (a, b) { return a.rank - b.rank; });
        return K.cap(out.map(function (x) { return x.r; }), 8);
    }
};

