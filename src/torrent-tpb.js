// ThePirateBay przez publiczne API apibay.org (ZWERIFYKOWANE: JSON + info_hash).
// Obsługuje: tytuły z TMDB, frazy testowe, filtrowanie S/E, ranking wyników.
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];

        // Zapytania wielotytułowe: fraza testowa albo PL + oryginał + aliasy z TMDB
        // (apibay indeksuje polskie tytuły release'ów z lektorem).
        var queries = sub.phrase ? [sub.phrase] : titles.slice(0, 3);
        var cats = (String(mediaType).toLowerCase() === 'movie') ? ['207', '204', ''] : ['205', '208', ''];
        var list = null, usedQuery = null;
        for (var qi = 0; qi < queries.length && !list; qi++) {
            for (var c = 0; c < cats.length && !list; c++) {
                var url = 'https://apibay.org/q.php?q=' + encodeURIComponent(queries[qi]) + (cats[c] ? '&cat=' + cats[c] : '');
                try {
                    var j = await K.httpJSON(url);
                    if (Array.isArray(j) && j.length && !j[0].no_results) { list = j; usedQuery = queries[qi]; }
                } catch (e) { K.log('[tpb] kategoria ' + cats[c] + ' nieudana: ' + e.message); }
            }
        }
        if (!list) return [];

        var seen = {};
        var scored = [];
        for (var i = 0; i < list.length; i++) {
            var t = list[i];
            var hash = String(t.info_hash || '').toLowerCase();
            var name = t.name || '';
            if (!hash || !name || seen[hash]) continue;
            seen[hash] = true;

            // Filtrowanie po S/E gdy podano (a nazwa je zawiera).
            if (!K.seMatches(name, season, episode)) continue;

            // Trafność: pokrycie tytułu + bonus za IMDB z API apibay.
            var rel = 0;
            if (sub.imdb && String(t.imdb || '').toLowerCase() === String(sub.imdb).toLowerCase()) rel += 2;
            if (titles.length && K.matchesTitle(name, titles, sub.year)) rel += 1;
            if (!sub.phrase && rel === 0) continue; // odrzuć śmieciowe wyniki przy realnym TMDB id

            var seeders = parseInt(t.seeders, 10) || 0;
            var leechers = parseInt(t.leechers, 10) || 0;
            var pl = K.plAudioInfo(name);
            scored.push({
                // priorytet: 1) audio PL, 2) napisy PL, 3) reszta; potem seedery i trafność
                rel: K.plRank(pl.rank, seeders) + rel,
                r: K.out(name, 'ThePirateBay', K.magnet(hash, name), {
                    quality: K.parseQuality(name),
                    size: K.humanSize(parseInt(t.size, 10)),
                    language: pl.language,
                    seeders: seeders,
                    peers: leechers,
                    infoHash: hash
                })
            });
        }
        scored.sort(function (a, b) { return b.rel - a.rel; });
        return K.cap(scored.map(function (x) { return x.r; }), 60);
    }
};
