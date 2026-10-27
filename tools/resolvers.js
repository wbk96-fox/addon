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
        if (BYSE_DOMAINS.test(h)) return byse(embedUrl, parentReferer);
        K.log('[auto] brak resolvera dla ' + h);
        return null;
    }

    return {
        cda: cda, streamtape: streamtape, sibnet: sibnet, vidmoly: vidmoly,
        fsst: fsst, vidara: vidara, veev: veev, byse: byse, filemoonUnpack: filemoonUnpack, unpackPacked: unpackPacked, auto: auto, sha256: sha256
    };
})();
