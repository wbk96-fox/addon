// BitSearch (bitsearch.to) — metaindeks DHT (ZWERIFYKOWANE: HTML bez Cloudflare,
// hash torrenta wprost w linku /download/torrent/<HASH>).
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];
        var primary = sub.phrase || titles[0];
        var q = primary + (sub.year && !sub.phrase ? ' ' + sub.year : '');

        var html = '';
        try {
            var r = await K.http('https://bitsearch.to/search?q=' + encodeURIComponent(q) + '&sort=-seeders');
            if (!r.resp.ok || r.challenge) { K.log('[bitsearch] HTTP ' + r.resp.status + (r.challenge ? ' (CF)' : '')); return []; }
            html = r.body;
        } catch (e) { K.log('[bitsearch] ' + e.message); return []; }

        // Wynik (układ potwierdzony): <h3><a>TYTUŁ</a></h3> ... meta(size/date)
        // ... swarm(seeders/leechers) ... NA KOŃCU link /download/torrent/<HASH>.
        // Czyli: dane wiersza są PRZED linkiem (okno "head"), nie po nim.
        var re = /\/download\/torrent\/([A-F0-9a-f]{40})[^"]*/g;
        var seen = {};
        var out = [];
        var m;
        while ((m = re.exec(html)) !== null) {
            var hash = m[1].toLowerCase();
            if (seen[hash]) continue;
            var head = html.slice(Math.max(0, m.index - 5000), m.index);
            var tail = html.slice(m.index, m.index + 1200);

            var title = null;
            // Tytuł z ostatniego h3 przed linkiem (najbliższy temu wierszowi).
            var h3re = /<h3[^>]*>\s*<a[^>]*href="\/torrent\/[a-f0-9]+"[^>]*>([\s\S]{3,200}?)<\/a>/g;
            var h3m, lastH3 = null;
            while ((h3m = h3re.exec(head)) !== null) lastH3 = h3m;
            if (lastH3) title = K.htmlDecode(lastH3[1].replace(/<[^>]*>/g, '').trim());
            if (!title) {
                var tMatch = tail.match(/\?title=([^"&]+)/);
                if (tMatch) { try { title = decodeURIComponent(tMatch[1]); } catch (e1) { title = null; } }
            }
            if (!title) continue;
            title = K.htmlDecode(title);

            // Filtry: tytuł, S/E.
            if (!sub.phrase && titles.length && !K.matchesTitle(title, titles, sub.year)) continue;
            if (!K.seMatches(title, season, episode)) continue;

            // Rozmiar i seedery z okna PRZED linkiem.
            var size = null, seeders = null, peers = null;
            var szAll = head.match(/<span>\s*([0-9.]+\s*(?:KB|MB|GB|TB))\s*<\/span>/gi);
            if (szAll && szAll.length) {
                var sm = szAll[szAll.length - 1].match(/([0-9.]+\s*(?:KB|MB|GB|TB))/i);
                if (sm) size = sm[1];
            }
            var sd = head.match(/font-medium">([0-9]+)<\/span>\s*<span[^>]*>\s*seeders/i);
            if (sd) seeders = parseInt(sd[1], 10);
            var lc = head.match(/font-medium">([0-9]+)<\/span>\s*<span[^>]*>\s*leechers/i);
            if (lc) peers = parseInt(lc[1], 10);

            seen[hash] = true;
            var pl = K.plAudioInfo(title);
            out.push({
                rel: K.plRank(pl.rank, seeders || 0),
                r: K.out(title, 'BitSearch', K.magnet(hash, title), {
                    quality: K.parseQuality(title),
                    size: size,
                    language: pl.language,
                    seeders: seeders,
                    peers: peers,
                    infoHash: hash
                })
            });
        }
        out.sort(function (a, b) { return b.rel - a.rel; });
        return K.cap(out.map(function (x) { return x.r; }), 60);
    }
};
