// Maps line:col positions in the built dist/viewer.js (as a browser's stack trace prints them, 1-based) back to the
// sources, with dist/viewer.js.map from the same build. Positions come from the arguments, else from stack trace text
// on stdin.
// Usage: npm run trace -- [<line:col> ...] [< trace.txt]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const map = JSON.parse(readFileSync(resolve(ROOT, 'dist/viewer.js.map'), 'utf8'));
const B64 = Object.fromEntries(
    [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]),
);
function vlq(s) {
    const out = [];
    for (let i = 0, v = 0, sh = 0; i < s.length; i++) {
        const d = B64[s[i]];
        v += (d & 31) << sh;
        sh += 5;
        if (!(d & 32)) {
            out.push(v & 1 ? -(v >>> 1) : v >>> 1);
            v = sh = 0;
        }
    }
    return out;
}
// per generated line: [col, source, line, col, name?] segments with absolute values
const lines = [];
{
    let src = 0,
        ol = 0,
        oc = 0,
        nm = 0;
    for (const ln of map.mappings.split(';')) {
        let col = 0;
        const segs = [];
        for (const s of ln ? ln.split(',') : []) {
            const v = vlq(s);
            col += v[0];
            if (v.length >= 4) {
                src += v[1];
                ol += v[2];
                oc += v[3];
                if (v.length >= 5) nm += v[4];
                segs.push([col, src, ol, oc, v.length >= 5 ? nm : -1]);
            }
        }
        lines.push(segs);
    }
}
function lookup(line, col) {
    const segs = lines[line - 1] || [];
    let hit = null;
    for (const s of segs) {
        if (s[0] > col - 1) break;
        hit = s;
    }
    if (!hit) return null;
    return `${map.sources[hit[1]]}:${hit[2] + 1}:${hit[3] + 1}${hit[4] >= 0 ? ` (${map.names[hit[4]]})` : ''}`;
}
const args = process.argv.slice(2);
const text = args.length ? args.join('\n') : readFileSync(0, 'utf8');
for (const ln of text.split(/\r?\n/)) {
    const m = ln.match(/(\d+):(\d+)\)?\s*$/);
    if (!m) {
        if (ln.trim()) console.log(ln);
        continue;
    }
    console.log(`${ln.trim()}  ->  ${lookup(Number(m[1]), Number(m[2])) || 'no mapping'}`);
}
