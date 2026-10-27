// TorrentDownload.info — metaindeks (ZWERIFYKOWANE: zwykły HTML 200 bez CF,
// hash torrenta wprost w ścieżce linku /<HASH>/<NAZWA>).
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];
        var primary = sub.phrase || titles[0];

        var queries = sub.phrase ? [primary] : (titles.length > 1 ? [primary, titles[1], titles[0]] : [primary]);
        var html = '';
        for (var qi = 0; qi < queries.length; qi++) {
            try {
                var r = await K.http('https://www.torrentdownload.info/search?q=' + encodeURIComponent(queries[qi]));
                if (!r.resp.ok || r.challenge) { K.log('[tdl] HTTP ' + r.resp.status + (r.challenge ? ' (CF)' : '')); continue; }
                html = r.body;
                if (html.indexOf('/td.php') >= 0 || /[A-F0-9a-f]{40}\//.test(html)) break; // wyniki obecne
            } catch (e) { K.log('[tdl] ' + e.message); }
        }
        if (!html) return [];

        // Wiersz wyniku (układ potwierdzony): reklamy mają href /td.php lub pełne
        // URL-e — odfiltruje je wymóg ścieżki "/<HEX40>/<slug>".
        // <td class="tdleft"><div class="tt-name"><a href="/HASH/SLUG">TYTUŁ</a>
        //   <span class="smallish"> » KATEGORIA</span>...</td>
        //   <td class="tdnormal">WIEK</td><td class="tdnormal">ROZMIAR</td>
        //   <td class="tdseed">SEEDY</td><td class="tdleech">LEECHERZY</td></tr>
        var rowRe = /<a href="\/([A-F0-9a-f]{40})\/([^"]*)">\s*([\s\S]{3,200}?)<\/a>([\s\S]{0,700}?)<\/tr>/g;
        var seen = {};
        var out = [];
        var m;
        while ((m = rowRe.exec(html)) !== null) {
            var hash = m[1].toLowerCase();
            if (seen[hash]) continue;
            var title = K.htmlDecode(m[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
            if (!title) { try { title = decodeURIComponent(m[2]); } catch (e1) { title = m[2]; } }
            if (!title) continue;

            if (!sub.phrase && titles.length && !K.matchesTitle(title, titles, sub.year)) continue;
            if (!K.seMatches(title, season, episode)) continue;

            var rest = m[4];
            var seeders = null, peers = null, size = null;
            var sd = rest.match(/tdseed[^>]*>\s*([0-9,]+)/i);
            if (sd) seeders = parseInt(sd[1].replace(/,/g, ''), 10);
            var lc = rest.match(/tdleech[^>]*>\s*([0-9,]+)/i);
            if (lc) peers = parseInt(lc[1].replace(/,/g, ''), 10);
            var sz = rest.match(/>([0-9.]+\s*(?:KB|MB|GB|TB))</i);
            if (sz) size = sz[1];

            seen[hash] = true;
            var pl = K.plAudioInfo(title);
            out.push({
                rel: K.plRank(pl.rank, seeders || 0),
                r: K.out(title, 'TorrentDownload', K.magnet(hash, title), {
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
