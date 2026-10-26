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
