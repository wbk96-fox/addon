// Seriale.vip — polskie seriale i filmy (port z FanFilm serialevip.py,
// ZWERIFYKOWANE live): DLE search -> strona wpisu z news_id -> POST
// /engine/ajax/controller.php?mod=playlists (news_id, xfield=pl) -> lista
// torów (LEKTOR itd.) z embedami fsst.online / vidara.so -> resolvery
// (fsst: jwplayer file:"[Q]URL", vidara: POST /api/stream) -> pliki bezpośrednie.
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];
        var isMovie = String(mediaType).toLowerCase() === 'movie';
        var base = 'https://seriale.vip';

        // 1. Wyszukiwanie DLE.
        var hits = [];
        var queries = sub.phrase ? [sub.phrase] : titles.slice(0, 3);
        for (var qi = 0; qi < queries.length && !hits.length; qi++) {
            try {
                var r = await K.http(base + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(queries[qi]));
                if (!r.resp.ok) continue;
                var re = /href="https:\/\/seriale\.vip\/(films|serials)\/(\d+)-([a-z0-9-]+)\.html"/g;
                var m;
                while ((m = re.exec(r.body)) !== null && hits.length < 8) {
                    var slug = m[3];
                    var clean = slug.replace(/-online$/, '').replace(/-(\d{4})$/, ' $1');
                    hits.push({ newsId: m[2], slug: slug, path: m[1] + '/' + m[2] + '-' + m[3] + '.html', kind: m[1], title: K.htmlDecode(clean) });
                }
            } catch (e) { K.log('[serialevip] szukanie: ' + e.message); }
        }
        if (!hits.length) return [];

        // 2. Dopasowanie tytułu/roku; filmy z /films/, seriale z /serials/.
        var best = null;
        for (var i = 0; i < hits.length; i++) {
            var h = hits[i];
            if (isMovie && h.kind !== 'films') continue;
            if (!isMovie && h.kind !== 'serials') continue;
            var slugYear = (h.slug.match(/-(\d{4})$/) || [])[1];
            var ok = sub.phrase ? true : K.matchesTitle(h.title, titles, sub.year);
            if (ok && (!sub.year || !slugYear || slugYear === String(sub.year))) { best = h; break; }
            if (ok && !best) best = h;
        }
        if (!best) return [];

        // 3. news_id ze strony wpisu + playlista.
        var page = await K.http(base + '/' + best.path);
        if (!page.resp.ok) { K.log('[serialevip] strona HTTP ' + page.resp.status); return []; }
        var nm = page.body.match(/news_id\s*=\s*"?(\d+)"?/) || page.body.match(/news-id="(\d+)"/);
        if (!nm) { K.log('[serialevip] brak news_id'); return []; }
        var newsId = nm[1];
        var plst = await K.http(base + '/engine/ajax/controller.php?mod=playlists', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': page.resp.url || base + '/',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: 'news_id=' + encodeURIComponent(newsId) + '&xfield=pl'
        });
        if (!plst.resp.ok) { K.log('[serialevip] playlists HTTP ' + plst.resp.status); return []; }
        var pj;
        try { pj = JSON.parse(plst.body); } catch (e) { return []; }
        var html = (pj && pj.response) || '';
        if (!html) return [];

        // 4. Tory (data-id="X_Y_Z" + etykieta LEKTOR/DUBBING...) i wideo (data-file).
        // Serial: elementy wideo data-id="X_Y_Z_<sezon0>" i etykieta „<N> odcinek".
        var trackLang = {}; // prefix "X_Y" -> etykieta językowa
        var ti = /<li data-id="([^"]+)">([^<]+)<\/li>/g;
        var tm;
        while ((tm = ti.exec(html)) !== null) {
            var parts = tm[1].split('_');
            if (parts.length === 3) trackLang[parts[0] + '_' + parts[1]] = tm[2].trim().toUpperCase();
        }
        var vi = /<li data-file="([^"]+)" data-id="([^"]+)">([^<]*)<\/li>/g;
        var vm;
        var embeds = [];
        while ((vm = vi.exec(html)) !== null) {
            var fileId = vm[2].split('_');
            var label = vm[3].trim();
            if (fileId.length === 2) {
                // film: etykieta elementu wideo to język (np. „LEKTOR"), tor X_Y to dostawca
                embeds.push({ embed: vm[1], prefix: vm[2], langLabel: label, label: label, epNum: null, seasonIdx: null });
            } else if (fileId.length === 4) {
                // serial: X_Y = tor (język/dostawca), Z = provider, ostatni = sezon (0-based)
                var em = label.match(/(\d+)\s*odcinek/i);
                embeds.push({
                    embed: vm[1], prefix: fileId[0] + '_' + fileId[1],
                    langLabel: trackLang[fileId[0] + '_' + fileId[1]] || '',
                    label: label,
                    epNum: em ? parseInt(em[1], 10) : null,
                    seasonIdx: parseInt(fileId[3], 10)
                });
            }
        }
        if (!embeds.length) return [];

        // 5. Filtr sezon/odcinek (serial), preferencja LEKTOR -> reszta.
        var out = [];
        for (var e = 0; e < embeds.length && out.length < 8; e++) {
            var it = embeds[e];
            if (!isMovie) {
                if (season != null && it.seasonIdx != null && it.seasonIdx !== parseInt(season, 10) - 1) continue;
                if (episode != null && it.epNum != null && it.epNum !== parseInt(episode, 10)) continue;
            }
            var isLektor = /LEKTOR|LITERAK|DUBBING/.test(it.langLabel);
            var resolved = null;
            var hst = (it.embed.match(/^https?:\/\/([^\/]+)/) || [''])[1] || '';
            if (/fsst/.test(hst)) resolved = await __R.fsst(it.embed);
            else if (/vidara/.test(hst)) resolved = await __R.vidara(it.embed);
            else if (/veev\.to|poophq|doods/.test(hst)) resolved = await __R.veev(it.embed);
            else { K.log('[serialevip] pomijam host: ' + hst); continue; }
            if (!resolved) continue;

            var pli = K.plAudioInfo(isLektor ? 'Lektor PL' : (it.langLabel || 'EN'));
            out.push({
                rank: pli.rank,
                r: K.out(
                    (sub.phrase || titles[0] || best.title) +
                    (!isMovie && it.epNum != null ? ' — odc. ' + it.epNum : '') +
                    (resolved.quality ? ' [' + resolved.quality + ']' : '') +
                    (it.langLabel ? ' — ' + it.langLabel : ''),
                    'SerialeVIP', resolved.url,
                    {
                        quality: resolved.quality,
                        language: pli.language,
                        provider: 'SerialeVIP',
                        type: 'direct',
                        headers: resolved.headers
                    }
                )
            });
        }
        out.sort(function (a, b) { return a.rank - b.rank; });
        return K.cap(out.map(function (x) { return x.r; }), 8);
    }
};
