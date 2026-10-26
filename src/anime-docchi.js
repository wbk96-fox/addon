// Docchi (docchi.pl) — polskie anime (ZWERIFYKOWANE API: /v1/series/related/<tytuł>
// do szukania, /v1/episodes/find/<slug>/<nr> do playerów).
// Hosty: CDA (najczęstszy), Sibnet, GDrive, Mega. Zwracamy TYLKO pliki bezpośrednie:
//  - Sibnet: resolver linku shell.php -> mp4 (best-effort, serwis bywa blokowany),
//  - CDA: wymaga cf_clearance (SCRAPER_SETTINGS.cf_clearance lub cda_cf_clearance);
//    bez cookie challenge Cloudflare uniemożliwia odczyt player_data.
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var type = String(mediaType).toLowerCase();
        if (type === 'movie') return []; // docchi tylko seriale anime
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];
        if (episode == null) return [];

        // 1. Szukanie serii (endpoint related przyjmuje tytuł; zwraca tablicę).
        var slug = null, seriesTitle = null;
        var candidates = titles.slice(0, 4);
        for (var i = 0; i < candidates.length && !slug; i++) {
            try {
                var list = await K.httpJSON('https://api.docchi.pl/v1/series/related/' + encodeURIComponent(candidates[i]));
                if (Array.isArray(list) && list.length) {
                    // najlepsze pokrycie tokenów tytułu
                    var best = null, bestCov = -1;
                    for (var j = 0; j < list.length; j++) {
                        var cov = 0, tt = K.tokens(candidates[i]), n = K.normalize(list[j].title + ' ' + (list[j].title_en || ''));
                        for (var t = 0; t < tt.length; t++) { if (n.indexOf(tt[t]) >= 0) cov++; }
                        var score = tt.length ? cov / tt.length : 0;
                        if (score > bestCov) { bestCov = score; best = list[j]; }
                    }
                    if (best && bestCov >= 0.5 && best.series_type !== 'MOVIE') { slug = best.slug; seriesTitle = best.title; }
                }
            } catch (e) { K.log('[docchi] szukanie „' + candidates[i] + '": ' + e.message); }
        }
        if (!slug) return [];

        // 2. Player odcinka.
        var eps = [];
        try {
            eps = await K.httpJSON('https://api.docchi.pl/v1/episodes/find/' + encodeURIComponent(slug) + '/' + encodeURIComponent(parseInt(episode, 10)));
        } catch (e2) { K.log('[docchi] odcinki: ' + e2.message); return []; }
        if (!Array.isArray(eps) || !eps.length) return [];

        var out = [];
        var cfCookie = K.settings('cf_clearance', null) || K.settings('cda_cf_clearance', null);

        for (var p = 0; p < eps.length && out.length < 12; p++) {
            var ep = eps[p];
            var host = String(ep.player_hosting || '').toLowerCase();
            var link = String(ep.player || '');
            if (!link) continue;

            if (host === 'sibnet' && /videoid=\d+/.test(link)) {
                var direct = await __R.sibnet(link);
                if (direct) {
                    out.push(K.out((seriesTitle || slug) + ' odc. ' + episode + ' [Sibnet]', 'Docchi', direct.url, {
                        quality: direct.quality || K.parseQuality(direct.url), language: 'PL',
                        provider: 'Docchi', type: 'direct', headers: direct.headers
                    }));
                }
            } else if (host === 'cda' && cfCookie) {
                var cda = await __R.cda(link);
                if (cda) {
                    out.push(K.out((seriesTitle || slug) + ' odc. ' + episode + ' [CDA ' + (cda.quality || '') + ']', 'Docchi', cda.url, {
                        quality: cda.quality, language: 'PL', provider: 'Docchi', type: 'direct', headers: cda.headers
                    }));
                }
            }
            // GDrive/Mega/embed — bez resolvera, pomijamy (embedy nie odtwarzają się w ExoPlayer).
        }
        return K.cap(out, 12);
    }
};
