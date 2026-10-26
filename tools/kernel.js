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
    // 2 = reszta. Wykrywa konwencje release'owe PL.
    function plAudioInfo(name) {
        var n = String(name || '');
        var nl = n.toLowerCase();
        // audio PL
        var isLektor = /\blektor(?:\s*(?:pl|polski|ai|eng))?\b|\bdi?lektor\b|\bldr\b(?=\s*(?:pl|polski))/.test(nl);
        var isDub = /\bdubbing(?:\s*(?:pl|polski))?\b|\bdub(?:bing)?\s*pl\b|\bpl\s*dub\b|\bpl\.?dub(?:bing)?\b/.test(nl);
        var isPolish = /\bpolish\b|\bpolski\b|\bpolska\s*(?:wersja|polszczyzna)|\bwersja\s*polska\b|\bmi(?:edzy)?narrator\b/.test(nl);
        // samodzielne „PL" (np. „The Matrix 1999 PL 1080p") = zwykle audio PL
        var isBarePL = /(^|[^a-z0-9])pl([^a-z0-9]|$)/.test(nl) && !/\bpl\.?(sub|napisy|lektor|dub)/.test(nl) && !/\.(?:pl|us)\b/.test(nl);
        // napisy PL
        var isPlSub = /\bnap(?:isy)?\.?\s*(?:pl|polskie)\b|\bpl\s*sub(?:s|bed|beds|tit(?:le|les))?\b|\bsub(?:s|bed)?\s*pl\b|\bnapisy\b(?=.*(pl|polsk))|\bpolish\s*sub(?:s|titles)?\b|\bpl\.?subbed\b/.test(nl);
        var audio = null, subs = null;
        if (isLektor) audio = 'Lektor PL';
        else if (isDub) audio = 'Dubbing PL';
        else if (isPolish || (isBarePL && !isPlSub)) audio = 'Polski';
        if (isPlSub) subs = 'Napisy PL';
        var rank = 2;
        if (audio) rank = 0;
        else if (subs) rank = 1;
        return { rank: rank, audio: audio, subs: subs, language: audio || subs || 'EN' };
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
