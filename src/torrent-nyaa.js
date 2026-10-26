// Nyaa (nyaa.si) — największy indeks torrentów anime (ZWERIFYKOWANE: zwykły HTML
// 200 bez CF, magnety z trackerami wprost w wierszach tabeli).
// Język: wersje z napisami EN/PL-amatorskie; kategorie anime (1_2 sub, 1_4 raw).
module.exports = {
    getStreams: async function (tmdbId, mediaType, season, episode) {
        var K = __K;
        var type = String(mediaType).toLowerCase();
        if (type === 'movie') return []; // nyaa: głównie seriale; filmy przez BitSearch/TPB
        var sub = await K.resolveSubject(tmdbId, mediaType);
        var titles = sub.titles || [];
        if (!titles.length && !sub.phrase) return [];
        var primary = sub.phrase || titles[0];

        // Nyaa używa formatu „Tytuł - NNN" dla odcinków.
        var queries = [primary + (episode != null ? ' - ' + parseInt(episode, 10) : '')];
        if (episode != null) queries.push(primary); // zapasowo: filtr lokalny po numerze
        if (episode == null && season != null) queries[0] = primary + ' S' + (season < 10 ? '0' : '') + parseInt(season, 10);

        var rows = [];
        for (var q = 0; q < queries.length && !rows.length; q++) {
            try {
                var r = await K.http('https://nyaa.si/?q=' + encodeURIComponent(queries[q]) + '&f=0&c=0_0&s=seeders&o=desc');
                if (!r.resp.ok || r.challenge) { K.log('[nyaa] HTTP ' + r.resp.status + (r.challenge ? ' (CF)' : '')); continue; }
                rows = parseNyaa(K, r.body, sub, season, episode);
            } catch (e) { K.log('[nyaa] ' + e.message); }
        }
        return K.cap(rows, 60);
    }
};

function parseNyaa(K, html, sub, season, episode) {
    var out = [];
    var seen = {};
    var re = /<a href="magnet:\?xt=urn:btih:([a-zA-Z0-9]{32,44})[^"]*"[^>]*>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
        var hash = m[1].toLowerCase();
        if (seen[hash]) continue;
        var head = html.slice(Math.max(0, m.index - 3000), m.index);
        var tail = html.slice(m.index, m.index + 1500);

        // Tytuł z ostatniego linku /view/ przed magnetytem.
        var viewRe = /<a href="\/view\/\d+"[^>]*>([\s\S]{3,300}?)<\/a>/g;
        var vm, lastTitle = null;
        while ((vm = viewRe.exec(head)) !== null) lastTitle = vm[1];
        var title = lastTitle ? K.htmlDecode(lastTitle.replace(/<[^>]*>/g, '').trim()) : null;
        if (!title) continue;

        // Filtr tytułu (prefiksy grup [Subs] są ignorowane przez normalizację tokenów).
        if (sub.titles && sub.titles.length && !sub.phrase && !K.matchesTitle(title, sub.titles, sub.year)) continue;

        // Filtr S/E: nyaa pisze odcinek jako „ - NNN" lub „NNNv2".
        if (episode != null) {
            var epRe = new RegExp('[-–\\s](?:E|Ep\\.?\\s*)?0*' + parseInt(episode, 10) + '(?:v\\d+)?\\b', 'i');
            var packRe = /complete|batch|season\s*\d+|s\d{1,2}\s*(?:-|e)\d+/i;
            var hasEp = epRe.test(title);
            var isPack = packRe.test(title);
            if (!hasEp && !isPack) continue;
            if (hasEp && isPack && !K.matchesTitle(title, sub.titles || [], sub.year)) continue;
        }
        if (season != null && episode == null) {
            var sRe = new RegExp('\\bS0*' + parseInt(season, 10) + '\\b|Season\\s*0*' + parseInt(season, 10) + '\\b', 'i');
            if (!sRe.test(title)) continue;
        }

        // Komórki po magnetycie: rozmiar, data, seeders, leechers, ukończenia.
        var cells = [];
        var cellRe = /<td class="text-center"[^>]*>([^<]*)<\/td>/g;
        var cm;
        while ((cm = cellRe.exec(tail)) !== null) cells.push(cm[1].trim());
        var size = cells[0] || null;
        var seeders = cells[2] ? parseInt(cells[2].replace(/[^0-9]/g, ''), 10) : null;
        var peers = cells[3] ? parseInt(cells[3].replace(/[^0-9]/g, ''), 10) : null;

        seen[hash] = true;
        var pl = K.plAudioInfo(title);
        out.push({
            rel: K.plRank(pl.rank, seeders || 0),
            r: K.out(title, 'Nyaa', m[0].match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&'), {
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
    return out.map(function (x) { return x.r; });
}
