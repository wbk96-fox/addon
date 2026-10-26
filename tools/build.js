#!/usr/bin/env node
/**
 * Buduje finalne scrapery: tools/kernel.js + src/<nazwa>.js -> scrapers/<nazwa>.js
 * Użycie: node tools/build.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'scrapers');
const KERNEL = fs.readFileSync(path.join(__dirname, 'kernel.js'), 'utf8');
const RESOLVERS = fs.readFileSync(path.join(__dirname, 'resolvers.js'), 'utf8');

const BANNER = '// UWAGA: plik WYGENEROWANY przez tools/build.js — nie edytuj ręcznie.\n' +
    '// Źródło: src/{name}.js + tools/kernel.js (wspólna warstwa HTTP).\n\n';

fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
let errors = 0;

for (const f of files) {
    const name = f.replace(/\.js$/, '');
    const body = fs.readFileSync(path.join(SRC, f), 'utf8');
    const out = BANNER.replace('{name}', f) + KERNEL + '\n\n' + RESOLVERS + '\n\n' +
        '// ================= LOGIKA SCRAPERÓW: ' + name + ' =================\n' + body + '\n';
    const dest = path.join(OUT, f);

    // Podstawowa walidacja składni przed zapisem.
    try {
        new Function('module', 'exports', 'fetch', 'console', 'require', 'URL', 'URLSearchParams', 'atob', 'btoa', 'setTimeout', 'clearTimeout',
            out + '\nreturn module.exports;');
    } catch (e) {
        console.error('BŁĄD SKŁADNI w ' + f + ': ' + e.message);
        errors++;
        continue;
    }
    fs.writeFileSync(dest, out);
    console.log('OK  scrapers/' + f + '  (' + Math.round(out.length / 1024) + ' KB)');
}

console.log(errors === 0 ? 'Budowanie zakończone: ' + files.length + ' scraperów.' : 'Błędy: ' + errors);
process.exit(errors === 0 ? 0 : 1);
