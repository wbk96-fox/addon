# Repozytorium wtyczek PL (NuvioTV) — „Polskie Źródła PL”

Repozytorium scraperów JS (manifest.json + scrapers/*.js) w formacie kompatybilnym
z projektem **NuvioTV** (`PluginManager` + `PluginRuntime`: QuickJS, fetch, cheerio,
crypto-js). Obejmuje polskie serwisy anime **bez gotowych scraperów** oraz
**indeksy torrentów**.

## Dodanie w aplikacji

1. Uruchom serwer repozytorium:

   ```bash
   python3 server.py 8000
   ```

   (serwer wypisze adres w sieci lokalnej, np. `http://192.168.x.x:8000`;
   sprawdzenie życia: `http://<adres>:8000/health`)

2. W aplikacji NuvioTV: **Ustawienia → Pluginy / Repozytoria → Dodaj repozytorium**
   i wpisz adres `http://<adres>:8000` (aplikacja sama dociągnie `/manifest.json`).
   Telefon musi być w tej samej sieci co komputer.

> Alternatywnie działa zwykły `python3 -m http.server 8000` — ale bez `/health`,
> z domyślnym MIME i bez CORS.

## Skład zestawu (stan: 2026-10-26)

| Scraper | Źródło | Typ | Status LIVE |
|---|---|---|---|
| ThePirateBay (apibay) | apibay.org — JSON API | torrenty film+serial | ✅ (60 wyników) |
| EZTV | eztvx.to / eztv.re — JSON API | torrenty seriale | ⚠️ filtr IMDB po ich stronie bywa ignorowany |
| YTS (mirrory) | yts.lt / yts.am / movies-api.accel.li | torrenty filmy | ✅ (automatyczny mirror) |
| BitSearch | bitsearch.to — HTML | torrenty film+serial | ✅ (PL release'y rankowane na górze) |
| TorrentDownload | torrentdownload.info — HTML | torrenty film+serial | ✅ (49 wyników) |
| Nyaa (anime) | nyaa.si — HTML | torrenty anime | ✅ (One Piece — 31 wyników) |
| **MaxVOD** | maxvod.tv — API playera | **filmy+seriale PL, MP4 bezpośrednie** | ✅ („The Matrix [720p] — Lektor PL") |
| **SerialeVIP** | seriale.vip — DLE playlists | **filmy+seriale PL, fsst/vidara→mp4/m3u8** | ✅ (LEKTOR, odcinki po sezonach) |
| **Bajeczki24** | bajeczki24.pl — Meilisearch | **bajki/kreskówki PL** | ⚠️ działa, część pozycji za captcha bys* |
| **Frixysubs** | frixysubs.pl — JSON API | **anime PL, MP4/MKV bezpośrednie** | ✅ (fileditch — odtwarzane wprost) |
| **Docchi** | docchi.pl — JSON API | **anime PL** | ⚠️ Sibnet→MP4, CDA wymaga `cf_clearance` |

**Priorytetyzacja językowa (wszystkie scrapery torrentów + PL):**
1. audio PL — „Lektor PL", „Dubbing PL", samodzielne „PL" (konwencje release'owe:
   `LEKTOR`, `Lektor.PL`, `lektor-pl`, `Lektor AI`, `PLDUB`, `Dubbing.POLSKI`,
   `POLISH DUB`, `PL DUB`, `1999.PL.720p`, `Wersja polska` itd.),
2. obce audio + polskie napisy — `Napisy PL`, `NAPISY`, `PL.SUB`, `PLSUB`,
   `PL SUBBED`, `Subs PL`, `POLISH SUBS`, `Matrix.Pl.2003.NAPISY` itd.,
3. reszta.
Sortowanie: rank językowy → seedery → trafność tytułu; pole `language` przyjmuje
wartości „Lektor PL" / „Dubbing PL" / „Polski" / „Lektor PL + Napisy PL" /
„Napisy PL" / „EN". Domeny `.pl` („peb.pl", „www.x.pl") są odróżniane od
znaczników języka. Zestaw 42 przypadków brzegowych jest testowany offline
przy każdej weryfikacji (`verify_repo.js`, test regresyjny).

**Sygnatury polskich grup sceny/p2p** (`-BiA`, `-BDC`, `-VOiCE`, `-MHT/-MHTeam`,
`-GSK`, `-WST`, `-KSC`, `-SAV`, `-EGAMI`, `-NTb` itd.) podnoszą wynik do audio PL,
podobnie jak wydania **MULTi z polską grupą** oraz **tagi ścieżek audio**:
`PL.AC3`, `PL.EAC3`, `PL.DDP5.1`, `TrueHD.7.1.Atmos.PL` (przykłady sceny 2026:
`Gladiator.2000.POLISH.REPACK-BiA` → „Lektor PL"). Wydania łączone dostają
etykietę „Lektor PL + Napisy PL".

**Client Hints:** żądania z silnika Chrome dostawiają nagłówki `Sec-Ch-Ua`,
`Sec-Ch-Ua-Mobile` i `Sec-Ch-Ua-Platform` zgodne z wersją w UA — nowoczesne
filtry antybotowe flagują Chrome bez tych nagłówków.

**Unpacker Dean Edwardsa** (`p,a,c,k,e,d`) w silniku resolverów: jako fallback
gdy API hostów typu bys*/filemoon zawiedzie — odkodowuje zaciemnione skrypty
i wyciąga bezpośrednie m3u8/mp4.

**Doodstream** (`dood.*`, `ds2play`, `doods.pro`, `playmogo`…): pełny port
ResolveURL — follow przekierowań hosta, iframe, wzorzec `dsplayer.hotkeys…makePlay`,
dekodowanie pass_md5 (treść + 10 losowych znaków + token + timestamp).

**player.pl (Player/TVN)** — API AndroidTV działa (item/search, playlisty), ale
zawartość darmowa jest śladowa, a reszta za Widevine DRM (ITEM_NOT_PAID). Scraper
nie ma sensu bez konta płatnego; ewentualnie do dodania w przyszłości przez
`SCRAPER_SETTINGS.player_uid` (cookie użytkownika).

**Wyszukiwanie wielotytułowe:** scrapery torrentów odpytują źródła po PL tytule,
tytule oryginalnym i aliasach z TMDB (`alternative_titles`) — polskie tytuły
release'ów z lektorem trafiają więc do wyników (w aplikacji, z kluczem TMDB).

**Silnik resolverów** (`tools/resolvers.js`, porty z ResolveURL/FanFilm 2026):
CDA (`player_data` + dekodowanie znaków + `?wersja=`), Streamtape (`robotlink`),
Sibnet, Vidmoly (cookie `cf_turnstile_demo_pass`), Fsst (`[Q]URL` z jwplayer),
Vidara (`/api/stream`), Byse (bez captcha: `details`→`settings`→`playback`
z fingerprintem SHA-256; przy wymaganej captcha świadomie pomija).

## Architektura

```
addon/
├── manifest.json            ← manifest repozytorium (NuvioTV)
├── scrapers/*.js            ← finalne, samodzielne scrapery (WYGENEROWANE)
├── src/*.js                 ← logika scraperów (edytuj tutaj)
├── tools/kernel.js          ← wspólna warstwa HTTP wklejana do każdego scrapera
├── tools/build.js           ← builder: kernel + src/* → scrapers/*
├── verify/verify_repo.js    ← weryfikator (ładowanie jak w aplikacji + testy LIVE)
├── server.py                ← serwer z /health, MIME, CORS, logami po polsku
└── README.md
```

Dlaczego builder? Runtime NuvioTV ładuje każdy plik scrapera osobno (brak
importów międzyplikowych), więc wspólny kernel (rotacja UA, cookie jar z nagłówków
`set-cookie`, ponawianie z innym UA, wykrywanie Cloudflare, pomocnicze TMDB,
parsowanie S/E/jakości/rozmiaru) jest wklejany do każdego pliku na etapie budowania.

Po zmianie w `src/` lub `tools/kernel.js`:

```bash
node tools/build.js
```

## Kontrakt scrapera (jak w aplikacji)

`getStreams(tmdbId, mediaType, season, episode)` → tablica obiektów z niepustym
`url` oraz opcjonalnie: `title`, `name`, `quality`, `size`, `language`, `provider`,
`type`, `seeders`, `peers`, `infoHash`, `headers`, `subtitles`. Aplikacja filtruje
do 150 wyników (`.take(MAX_RESULT_ITEMS)`), odpowiedzi HTTP ≤ 5 MB, timeout
scraperów po stronie runtime.

Zasada jakości: **zwracamy tylko bezpośrednio odtwarzalne wyniki** — magnety
torrentów albo pliki mp4/mkv/m3u8. Embedy iframe (CDA/Streamtape/YouTube)
nie odtwarzają się w ExoPlayer, więc są pomijane, chyba że resolver da plik.

## Ustawienia scraperów (SCRAPER_SETTINGS)

W aplikacji ustawienia scrapera trafiają do `globalThis.SCRAPER_SETTINGS`:

- `cf_clearance` albo `cda_cf_clearance` — cookie Cloudflare dla CDA (skopiowany
  z przeglądarki po przejściu challenge); odblokowuje resolver CDA w Docchi.

Bez tych wartości Docchi zwraca wyniki tylko z hostów bez CF (Sibnet itd.),
a gdy i te są niedostępne z sieci — pustą listę (świadome zachowanie, bez
fałszywych obietnic).

## Weryfikacja

```bash
node verify/verify_repo.js             # mechanicznie + LIVE (sieć)
node verify/verify_repo.js --offline   # tylko mechanicznie
TMDB_API_KEY=xxx node verify/verify_repo.js   # pełna ścieżka TMDB (id numeryczne)
```

Weryfikator replikuje ścieżkę aplikacji: manifest → pobranie plików → opakowanie
`(function(){...})()` → `getStreams` → walidacja jak `parseJsonResults`
(`url` niepusty, typy pól), dodatkowo spójność manifest↔pliki i testy LIVE.

Ostatni wynik (2026-10-27, 11 scraperów, v2.3.0): **WSZYSTKIE KONTROLE OK** (testy LIVE włącznie).

## Ograniczenia (uczciwie)

- **Cloudflare** nie da się obejść samym fetch (UA/cookies nie wystarczą na
  challenge JS). Scrapery wykrywają wyzwanie, ponawiają z innym UA i korzystają
  z `cf_clearance` użytkownika, jeśli podane. Serwisy w całości za CF (CDA,
  1337x, Kickass, Torlock, Sibnet z tej sieci) nie zwrócą wyników bez cookie.
- **EZTV** zepsuł po swojej stronie filtr `imdb_id`/`search_string` — scraper
  poprawnie filtruje wyniki u siebie, ale EZTV potrafi zwrócić 0.
- **YTS** główna domena (yts.mx) bywa nieosiągalna — używamy mirrorów.
- Filmy/seriale PL z serwisów typu Obejrzyj/PremiumSmart/Bajeczki24 i hostów
  vidmoly/bys* wymagają resolverów embed z captcha/JS — poza zakresem tego
  repozytorium (nie ma sensu zwracać nieodtwarzalnych linków).
