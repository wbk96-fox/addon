// MaxVOD (maxvod.tv) — polskie filmy i seriale (port z FanFilm maxvod.py,
// ZWERIFYKOWANE live): /search?q= -> /movie/<slug> lub /series/<slug> ->
// /player/<slug> (film) lub /player/series/<slug>?sezon=S&odcinek=E (serial) ->
// const SOURCES=[{uuid,mediaType:'video',langLabel:'Napisy PL'|'Lektor PL'...}] ->
// /api/player/url/<uuid> -> /player/play/<uuid> (302) -> bezpośrednie MP4.
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var isMovie = String(mediaType).toLowerCase() === 'movie';
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];
        var base = 'https://maxvod.tv';
        var typePath = isMovie ? 'movie' : 'series';

        // 1. Wyszukiwanie po aliasach (maxvod pokazuje „Tytuł PL / Tytuł ORIG").
        var candidates = [];
        var queries = sub.phrase ? [sub.phrase] : titles.slice(0, 3);
        for (var qi = 0; qi < queries.length && !candidates.length; qi++) {
            try {
                var r = await K.http(base + '/search?q=' + encodeURIComponent(queries[qi]));
                if (!r.resp.ok) continue;
                if (r.body.indexOf('Zbyt wiele zapyta') >= 0) { K.log('[maxvod] throttling'); continue; }
                var re = new RegExp('href="/' + typePath + '/([a-z0-9-]+)"[\\s\\S]{0,900}?alt="([^"]*)"', 'g');
                var m;
                while ((m = re.exec(r.body)) !== null) candidates.push({ slug: m[1], label: K.htmlDecode(m[2]) });
            } catch (e) { K.log('[maxvod] szukanie: ' + e.message); }
        }
        if (!candidates.length) return [];

        // 2. Dopasowanie tytułu i roku (slug często kończy się „-YYYY").
        var best = null;
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var cTitles = c.label.split('/').map(function (x) { return x.trim(); });
            var ok = sub.phrase ? true : cTitles.some(function (t) { return K.matchesTitle(t, titles, sub.year); });
            if (!ok) continue;
            var ym = c.slug.match(/-(\d{4})$/);
            var yearOk = !sub.year || !ym || ym[1] === String(sub.year);
            if (yearOk) { best = c; break; }
            if (!best) best = c; // zapasowo pierwszy pasujący tytułem
        }
        if (!best) return [];

        // 3. Player: film bez parametrów; serial ?sezon=&odcinek= (1-based).
        var playerUrl = base + '/player/' + (isMovie ? '' : 'series/') + best.slug;
        if (!isMovie) {
            playerUrl += '?sezon=' + encodeURIComponent(season != null ? parseInt(season, 10) : 1) +
                '&odcinek=' + encodeURIComponent(episode != null ? parseInt(episode, 10) : 1);
        }
        var pr = await K.http(playerUrl, { headers: { 'Referer': base + '/' } });
        if (!pr.resp.ok) { K.log('[maxvod] player HTTP ' + pr.resp.status); return []; }

        // 4. SOURCES — tylko mediaType 'video' (bezpośrednie); iframe pomijamy.
        var sm = pr.body.match(/const\s+SOURCES\s*=\s*(\[.*?\]);/s);
        if (!sm) { K.log('[maxvod] brak SOURCES'); return []; }
        var sources;
        try { sources = JSON.parse(sm[1].replace(/\\/g, '\\\\')); } catch (e1) {
            try { sources = JSON.parse(sm[1]); } catch (e2) { return []; }
        }
        var direct = (sources || []).filter(function (s) { return s.mediaType === 'video' && s.uuid; });
        if (!direct.length) return [];

        // 5. uuid -> /api/player/url -> /player/play (302 -> plik).
        var out = [];
        for (var d = 0; d < direct.length && out.length < 8; d++) {
            var src = direct[d];
            var apiUrl = base + '/api/player/url/' + encodeURIComponent(src.uuid) +
                (src.variant === 'original' ? '?original=1' : '');
            try {
                var ar = await K.http(apiUrl, { headers: { 'Referer': playerUrl } });
                if (!ar.resp.ok) continue;
                var aj = JSON.parse(ar.body);
                if (!aj || !aj.url) continue;
                var playUrl = base + aj.url;
                var res = await K.http(playUrl, { headers: { 'Referer': base + '/' }, redirect: 'manual' });
                var loc = res.resp.headers.get('location');
                var finalUrl = loc || (res.resp.ok ? playUrl : null);
                if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) continue;

                var langLabel = String(src.langLabel || src.langKey || 'PL');
                var pl = K.plAudioInfo(langLabel);
                out.push({
                    rank: pl.rank,
                    r: K.out(
                        (sub.phrase || titles[0] || best.label) + (src.quality ? ' [' + src.quality + ']' : '') +
                        (pl.audio || pl.subs ? ' — ' + (pl.audio || pl.subs) : ''),
                        'MaxVOD',
                        finalUrl,
                        {
                            quality: K.parseQuality(String(src.quality || '')),
                            language: pl.language,
                            provider: 'MaxVOD',
                            type: 'direct',
                            headers: { 'Referer': base + '/', 'User-Agent': K.ua(0) }
                        }
                    )
                });
            } catch (e2) { K.log('[maxvod] uuid ' + src.uuid + ': ' + e2.message); }
        }
        out.sort(function (a, b) { return a.rank - b.rank; });
        return K.cap(out.map(function (x) { return x.r; }), 8);
    }
};
