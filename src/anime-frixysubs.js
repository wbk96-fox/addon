// Frixysubs (frixysubs.pl) — polskie fansuby anime (ZWERIFYKOWANE API:
// /api/anime -> katalog; /api/anime/<id> -> odcinki z playerami, w tym
// BEZPOŚREDNIE pliki MP4/MKV na fileditch — odtwarzalne wprost przez ExoPlayer).
// Szukanie: TMDB tytuł + tytuły alternatywne; katalog API filtrowany lokalnie.
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];

        // 1. Katalog (API ignoruje parametry wyszukiwania; limit=1000 pokrywa cały
        // katalog — ZWERIFYKOWANE: 314 serii). Filtrowanie lokalne.
        var catalog = [];
        try {
            var j = await K.httpJSON('https://frixysubs.pl/api/anime?limit=1000');
            catalog = (j && j.series) || [];
        } catch (e) { K.log('[frixysubs] katalog: ' + e.message); return []; }
        if (!catalog.length) return [];

        // 2. Dopasowanie serii: każdy alias (TMDB tytuł + alternatywne) kontra
        // tytuł i aliasy serii (subtitles/keywords). Uwzględnia romaji z makronami.
        var titleNorms = titles.map(function (t) { return K.normalize(t); }).filter(Boolean);
        function fits(series) {
            var names = [series.title].concat(series.subtitles || [], series.keywords || []);
            for (var i = 0; i < names.length; i++) {
                var n = K.normalize(names[i]);
                if (!n) continue;
                for (var j = 0; j < titleNorms.length; j++) {
                    var tn = titleNorms[j];
                    if (n === tn) return true;
                    if (n.length > 5 && (n.indexOf(tn) >= 0 || tn.indexOf(n) >= 0)) return true;
                    var tt = K.tokens(tn);
                    if (!tt.length) continue;
                    var hit = 0;
                    for (var k = 0; k < tt.length; k++) { if (n.indexOf(tt[k]) >= 0) hit++; }
                    if (hit / tt.length >= 0.8) return true;
                }
            }
            return false;
        }
        var matched = catalog.filter(fits);
        if (!matched.length) return [];

        // 3. Odcinki i playery — zwracamy TYLKO bezpośrednie pliki (mp4/mkv/m3u8).
        var out = [];
        var epNum = (episode != null) ? parseInt(episode, 10) : null;
        var limit = Math.min(matched.length, 3);
        for (var i = 0; i < limit; i++) {
            var s = matched[i];
            try {
                var det = await K.httpJSON('https://frixysubs.pl/api/anime/' + encodeURIComponent(s.id));
                var eps = det && det.episodes;
                if (!Array.isArray(eps) || !eps.length) continue;

                for (var e = 0; e < eps.length; e++) {
                    var ep = eps[e];
                    var num = ep.number != null ? parseInt(ep.number, 10) : null;
                    if (epNum != null && num != null && num !== epNum) continue;
                    if (season != null && ep.season != null && parseInt(ep.season, 10) !== parseInt(season, 10)) continue;

                    var players = ep.players || [];
                    for (var p = 0; p < players.length; p++) {
                        var pl = players[p];
                        var link = String(pl.link || '');
                        // 1) Bezpośrednie pliki (fileditch) — najpewniejsza ścieżka.
                        if (/\.(mp4|mkv|m3u8|mpd)(\?|$)/i.test(link)) {
                            var label0 = (det.title || s.title) + (num != null ? ' — odc. ' + num : '') + ' [' + (pl.name || 'PL') + ']';
                            out.push(K.out(label0, 'Frixysubs', link, {
                                quality: K.parseQuality(link) || null,
                                language: 'PL',
                                provider: 'Frixysubs',
                                type: 'direct'
                            }));
                            continue;
                        }
                        // 2) Streamtape — resolver kernelowy na bezpośrednie mp4
                        // (best-effort: martwe linki/404 po stronie hosta pomijamy).
                        if (/streamtape|strtape|strcloud|shavetape|scloud\.online/i.test(link)) {
                            var st = await __R.streamtape(link);
                            if (st) {
                                var label1 = (det.title || s.title) + (num != null ? ' — odc. ' + num : '') + ' [Streamtape]';
                                out.push(K.out(label1, 'Frixysubs', st.url, {
                                    quality: st.quality || K.parseQuality(st.url) || null,
                                    language: 'PL',
                                    provider: 'Frixysubs',
                                    type: 'direct',
                                    headers: st.headers
                                }));
                            }
                        }
                        // CDA i pozostałe embedy — bez cf_clearance niewykonalne; pomijamy.
                    }
                }
            } catch (e2) { K.log('[frixysubs] seria ' + (s.title || s.id) + ': ' + e2.message); }
        }
        return K.cap(out, 40);
    }
};
