// UWAGA: plik WYGENEROWANY przez tools/build.js — nie edytuj ręcznie.
// Źródło: src/torrent-eztv.js.js + tools/kernel.js (wspólna warstwa HTTP).

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
            if (data && data.playback) { K.log('[byse] playback zaszyfrowany (AES-GCM) — pomijam'); return null; }
            return null;
        } catch (e) { K.log('[byse] ' + e.message); return null; }
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
        if (BYSE_DOMAINS.test(h)) return byse(embedUrl, parentReferer);
        K.log('[auto] brak resolvera dla ' + h);
        return null;
    }

    return {
        cda: cda, streamtape: streamtape, sibnet: sibnet, vidmoly: vidmoly,
        fsst: fsst, vidara: vidara, byse: byse, auto: auto, sha256: sha256
    };
})();


// ================= LOGIKA SCRAPERÓW: torrent-eztv =================
// EZTV — torrenty seriali po IMDB id (ZWERIFYKOWANE: eztvx.to i eztv.re).
// API niechciane "najnowsze" przy pustym filtrze imdb — dlatego wymaga imdb id.
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var type = String(mediaType).toLowerCase();
        if (type !== 'tv' && type !== 'series' && type !== 'anime') return [];

        var sub = await K.resolveSubject(tmdbId, mediaType);
        var imdb = sub.imdb || (/^tt\d+$/i.test(String(tmdbId)) ? String(tmdbId) : null);
        if (!imdb) return [];

        var num = imdb.replace(/^tt/i, '');
        var endpoints = [
            'https://eztvx.to/api/get-torrents?imdb_id=' + encodeURIComponent(num),
            'https://eztv.re/api/get-torrents?imdb_id=' + encodeURIComponent(num)
        ];

        var torrents = [];
        for (var i = 0; i < endpoints.length && !torrents.length; i++) {
            try {
                var j = await K.httpJSON(endpoints[i] + '&limit=100');
                if (j && Array.isArray(j.torrents) && j.torrents.length) {
                    // Zabezpieczenie: eztv przy niestabilnym filtrze imdb zwraca najnowsze
                    // pozycje — odrzucamy te, które nie pasują do tytułu (bez fallbacku,
                    // żeby nie pokazywać przypadkowych wyników).
                    var titles = sub.titles && sub.titles.length ? sub.titles : null;
                    torrents = j.torrents.filter(function (t) {
                        var fn = String(t.filename || t.title || '');
                        if (!titles) return true;
                        return K.matchesTitle(fn, titles, sub.year) || titles.some(function (tt) {
                            return K.normalize(fn).indexOf(K.normalize(tt)) >= 0;
                        });
                    });
                }
            } catch (e) { K.log('[eztv] ' + endpoints[i] + ': ' + e.message); }
        }
        if (!torrents.length) return [];

        var seen = {};
        var out = [];
        for (var k = 0; k < torrents.length; k++) {
            var t = torrents[k];
            var magnet = String(t.magnet_url || '');
            var hash = String(t.hash || '').toLowerCase();
            if (!magnet) { if (!hash) continue; magnet = K.magnet(hash, t.filename || ''); }
            var name = String(t.filename || t.title || '');
            if (!name) continue;
            if (!seen[hash] && hash) seen[hash] = true;

            if (season != null && t.season != null && parseInt(t.season, 10) !== parseInt(season, 10)) continue;
            if (episode != null && t.episode != null && parseInt(t.episode, 10) !== parseInt(episode, 10)) continue;
            if (!K.seMatches(name, season, episode)) continue;

            var pl = K.plAudioInfo(name);
            out.push({
                rel: K.plRank(pl.rank, parseInt(t.seeds, 10) || 0),
                r: K.out(name, 'EZTV', magnet, {
                    quality: K.parseQuality(name),
                    size: K.humanSize(parseInt(t.size_bytes, 10)),
                    language: pl.language,
                    seeders: parseInt(t.seeds, 10) || 0,
                    peers: parseInt(t.peers, 10) || 0,
                    infoHash: hash
                })
            });
        }
        out.sort(function (a, b) { return b.rel - a.rel; });
        return K.cap(out.map(function (x) { return x.r; }), 60);
    }
};

