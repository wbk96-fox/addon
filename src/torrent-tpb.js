// ThePirateBay przez publiczne API apibay.org (ZWERIFYKOWANE: JSON + info_hash).
// Obsługuje: tytuły z TMDB, frazy testowe, filtrowanie S/E, ranking wyników.
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];
        var primary = sub.phrase || titles[0];

        // apibay: q.php z kategorią (207=HD movies, 205=TV) lub bez (204=Movies, 208=HD-TV).
        var cats = (String(mediaType).toLowerCase() === 'movie') ? ['207', '204', ''] : ['205', '208', ''];
        var list = null;
        for (var c = 0; c < cats.length && !list; c++) {
            var url = 'https://apibay.org/q.php?q=' + encodeURIComponent(primary) + (cats[c] ? '&cat=' + cats[c] : '');
            try {
                var j = await K.httpJSON(url);
                if (Array.isArray(j) && j.length && !j[0].no_results) list = j;
            } catch (e) { K.log('[tpb] kategoria ' + cats[c] + ' nieudana: ' + e.message); }
        }
        if (!list) {
            // Ostateczność: zapytanie bez kategorii po drugim tytule/aliasie.
            var alt = titles[1] || primary;
            try { var j2 = await K.httpJSON('https://apibay.org/q.php?q=' + encodeURIComponent(alt)); if (Array.isArray(j2) && j2.length && !j2[0].no_results) list = j2; } catch (e2) {}
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
