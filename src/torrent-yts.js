// YTS — torrenty filmów. yts.mx bywa nieosiągalny (DNS) — używamy mirrorów
// (ZWERIFYKOWANE: yts.lt i yts.am odpowiadają tym samym API v2).
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        if (String(mediaType).toLowerCase() !== 'movie') return [];
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];
        var primary = sub.phrase || titles[0];
        var year = sub.year;

        var mirrors = ['https://yts.lt', 'https://yts.am', 'https://movies-api.accel.li'];
        var movies = null;
        try {
            movies = await K.firstMirror(mirrors, function (m) {
                var url = m + '/api/v2/list_movies.json?query_term=' + encodeURIComponent(primary) + '&limit=50&sort_by=seeds';
                return K.httpJSON(url).then(function (j) {
                    var list = j && j.data && j.data.movies;
                    if (!Array.isArray(list) || !list.length) throw new Error('brak wyników');
                    return list;
                });
            });
        } catch (e) { K.log('[yts] wszystkie mirrory nieudane: ' + e.message); return []; }

        var out = [];
        for (var m = 0; m < movies.length; m++) {
            var movie = movies[m];
            // Dopasowanie tytułu/roku do TMDB (YTS bywa zwracał zbliżone nazwy).
            var candTitles = [movie.title, movie.title_long].concat(movie.alternative_titles || []);
            var ok = sub.phrase ? true : candTitles.some(function (t) { return K.matchesTitle(t, titles, year); });
            if (!ok) continue;
            if (year && movie.year && parseInt(movie.year, 10) !== parseInt(year, 10)) continue;

            var ts = movie.torrents || [];
            for (var t = 0; t < ts.length; t++) {
                var tr = ts[t];
                var hash = String(tr.hash || '').toLowerCase();
                if (!hash) continue;
                var label = movie.title_long || movie.title;
                var q = String(tr.quality || '') + (String(tr.video_codec || '').toUpperCase() === 'H.265' ? ' x265' : '');
                // YTS zwraca size jako tekst („1.85 GB"), nie w bajtach.
                var sizeStr = /^[0-9.]+\s*(KB|MB|GB|TB)$/i.test(String(tr.size || '')) ? String(tr.size) : K.humanSize(parseInt(tr.size, 10));
                var trName = label + ' [' + tr.quality + ' ' + tr.type + ']';
                var pl = K.plAudioInfo(trName);
                out.push({
                    rel: K.plRank(pl.rank, parseInt(tr.seeds, 10) || 0) + (tr.quality === '1080p' ? 50 : 0),
                    r: K.out(trName, 'YTS', K.magnet(hash, label), {
                        quality: K.parseQuality(tr.quality) || K.parseQuality(label),
                        size: sizeStr,
                        language: pl.language,
                        seeders: parseInt(tr.seeds, 10) || 0,
                        peers: parseInt(tr.peers, 10) || 0,
                        infoHash: hash
                    })
                });
            }
        }
        out.sort(function (a, b) { return b.rel - a.rel; });
        return K.cap(out.map(function (x) { return x.r; }), 60);
    }
};
