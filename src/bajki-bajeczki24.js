// Bajeczki24 (bajeczki24.pl) — polskie bajki i kreskówki (port z FanFilm
// bajeczki24.py, ZWERIFYKOWANE live): Meilisearch multi-search (movies-v2 +
// tv-shows-v2) -> strona filmu/serialu -> <iframe src="https://bysesukior.com/e/..."> ->
// resolver Byse (ścieżka bez captcha z ResolveURL byse.py) -> plik bezpośredni.
// Wymóg: repozytorium obsługiwane przez aplikację z uwzględnieniem nosiciela
// strony jako Referer dla API bys (X-Embed-Origin/X-Embed-Referer).
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];
        var base = 'https://bajeczki24.pl';

        // 1. Meilisearch multi-search (token publiczny witryny).
        var q = sub.phrase || titles[0];
        var body = JSON.stringify({
            queries: [
                { indexUid: 'movies-v2', q: q },
                { indexUid: 'tv-shows-v2', q: q }
            ],
            federation: { offset: 0, limit: 10 }
        });
        var hits = [];
        try {
            var r = await K.http('https://api.bajeczki24.pl/radar/v1/multi-search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer 118b6cd0fd246c02d4fe6465a1e5c16d7ce09fb67935180da44a060db68855c2'
                },
                body: body
            });
            if (r.resp.ok) {
                var j = JSON.parse(r.body);
                hits = (j && j.hits) || [];
            } else { K.log('[bajeczki24] meili HTTP ' + r.resp.status); }
        } catch (e) { K.log('[bajeczki24] ' + e.message); }
        if (!hits.length) return [];

        // 2. Dopasowanie tytułu i roku (hit: title, releaseYear, path).
        var best = null;
        for (var i = 0; i < hits.length; i++) {
            var h = hits[i];
            var ok = sub.phrase ? true : (K.matchesTitle(h.title, titles, sub.year) ||
                titles.some(function (t) { return K.normalize(t) && K.normalize(h.title).indexOf(K.normalize(t)) >= 0; }));
            if (!ok) continue;
            if (sub.year && h.releaseYear && parseInt(h.releaseYear, 10) !== parseInt(sub.year, 10)) continue;
            best = h; break;
        }
        if (!best || !best.path) return [];

        // 3. Strona wpisu -> iframe odtwarzacza (byse* / cda).
        var pr = await K.http(base + best.path, { headers: { 'Referer': base + '/' } });
        if (!pr.resp.ok) { K.log('[bajeczki24] strona HTTP ' + pr.resp.status); return []; }
        var iframes = [];
        var im = /<iframe[^>]*src="(https?:\/\/[^"]+)"/g;
        var mm;
        while ((mm = im.exec(pr.body)) !== null) {
            var src = K.htmlDecode(mm[1]);
            if (/youtube|googletagmanager|doubleclick/.test(src)) continue;
            iframes.push(src);
        }
        if (!iframes.length) { K.log('[bajeczki24] brak iframe'); return []; }

        // 4. Resolver embedu -> plik bezpośredni.
        var out = [];
        var pageTitle = best.title || titles[0];
        for (var f = 0; f < iframes.length && out.length < 6; f++) {
            var emb = iframes[f];
            var host = (emb.match(/^https?:\/\/([^\/]+)/) || [''])[1] || '';
            var resolved = null;
            if (/byse|filemoon|streamlyplayer/i.test(host)) {
                resolved = await __R.byse(emb, base + best.path);
            } else if (/cda\.pl/.test(host)) {
                resolved = await __R.cda(emb);
            } else if (/streamtape|strtape|strcloud|shavetape/i.test(host)) {
                resolved = await __R.streamtape(emb);
            } else {
                K.log('[bajeczki24] brak resolvera dla ' + host);
                continue;
            }
            if (!resolved) continue;
            out.push(K.out(
                pageTitle + (season != null && episode != null ? ' — S' + season + 'E' + episode : '') +
                (resolved.quality ? ' [' + resolved.quality + ']' : ''),
                'Bajeczki24', resolved.url,
                {
                    quality: resolved.quality,
                    language: 'Dubbing PL',
                    provider: 'Bajeczki24',
                    type: 'direct',
                    headers: resolved.headers
                }
            ));
        }
        return K.cap(out, 6);
    }
};
