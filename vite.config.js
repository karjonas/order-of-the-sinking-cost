import { realpathSync, createReadStream, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { defineConfig } from 'vite-plus';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { savesDir } from './scripts/saves.js';

const ROOT = import.meta.dirname;

// The dev server opens the page at /, and /saves/<campaign>/<file> reads the game's save folder: GET and HEAD only, and anything that
// resolves outside the folder (backslashes, drive letters, ..) is not found
function saves() {
    return {
        name: 'soko:saves',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url !== '/') {
                    next();
                    return;
                }
                res.statusCode = 302;
                res.setHeader('Location', '/viewer.html');
                res.end();
            });
            server.middlewares.use('/saves', (req, res) => {
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    res.statusCode = 405;
                    res.setHeader('Allow', 'GET, HEAD');
                    res.end();
                    return;
                }
                let full = null;
                try {
                    const base = realpathSync.native(savesDir());
                    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
                    const p = realpathSync.native(resolve(base, ...rel.split('/').filter(Boolean)));
                    if ((p === base || p.startsWith(base + sep)) && statSync(p).isFile()) full = p;
                } catch {}
                if (!full) {
                    res.statusCode = 404;
                    res.end();
                    return;
                }
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Content-Length', statSync(full).size);
                res.setHeader('Cache-Control', 'no-store');
                if (req.method === 'HEAD') res.end();
                else createReadStream(full).pipe(res);
            });
        },
    };
}

// the schema's field notes and addresses are for the docs only
function schemaForPage() {
    return {
        name: 'soko:schema',
        enforce: 'pre',
        transform(code, id) {
            if (!id.replace(/\\/g, '/').endsWith('/data/schema.json')) return null;
            const schema = JSON.parse(code);
            for (const lst of [
                schema.base.fields,
                ...Object.values(schema.types)
                    .filter((t) => t.fields)
                    .map((t) => t.fields),
            ])
                for (const f of lst) {
                    delete f.notes;
                    delete f.at;
                }
            return { code: JSON.stringify(schema), map: null };
        },
    };
}

// The build writes the inlined page as viewer.html in the project root, and next to it viewer.html.map, a source map of
// the page itself (not referenced by it) for reading stack traces with scripts/trace.js. The script starts on its own
// line, so the script's map only needs that line offset.
const SCRIPT_TAG = '<script type="module" crossorigin>';
function pageOut() {
    let script = null;
    // the script as built, before vite:singlefile inlines it and drops it from the bundle
    const keepScript = {
        name: 'soko:script',
        apply: 'build',
        generateBundle: {
            order: 'pre',
            handler(_, bundle) {
                const js = Object.values(bundle).filter((c) => c.type === 'chunk');
                if (js.length !== 1 || !js[0].map)
                    this.error(`expected one script with a source map, got ${js.map((c) => c.fileName).join(', ')}`);
                script = js[0];
            },
        },
    };
    return [
        keepScript,
        {
            name: 'soko:page',
            apply: 'build',
            enforce: 'post',
            generateBundle(options, bundle) {
                delete bundle[script.fileName + '.map'];
                const page = bundle['viewer.html'];
                const extra = Object.keys(bundle).filter((k) => k !== 'viewer.html');
                if (!page || extra.length)
                    this.error(`expected only viewer.html in the bundle, got ${Object.keys(bundle).join(', ')}`);
                const at = page.source.indexOf(SCRIPT_TAG) + SCRIPT_TAG.length,
                    code = script.code.trim();
                if (
                    at < SCRIPT_TAG.length ||
                    script.code.trimStart() !== script.code ||
                    page.source.slice(at, at + code.length) !== code
                )
                    this.error('the script is not inlined as built');
                const html = page.source.slice(0, at) + '\n' + page.source.slice(at),
                    lines = html.slice(0, at + 1).split('\n').length - 1;
                const map = script.map,
                    dir = options.dir || resolve(ROOT, 'src/dist');
                const out = {
                    version: 3,
                    file: 'viewer.html',
                    sources: map.sources.map((s) => relative(ROOT, resolve(dir, s)).replace(/\\/g, '/')),
                    sourcesContent: map.sourcesContent.map((c, i) => (map.sources[i].endsWith('.json') ? null : c)),
                    names: map.names,
                    mappings: ';'.repeat(lines) + map.mappings,
                };
                writeFileSync(resolve(ROOT, 'viewer.html'), html);
                writeFileSync(resolve(ROOT, 'viewer.html.map'), JSON.stringify(out));
            },
        },
    ];
}

export default defineConfig({
    root: resolve(ROOT, 'src'),
    publicDir: false,
    plugins: [saves(), schemaForPage(), viteSingleFile(), pageOut()],
    json: { namedExports: false, stringify: true },
    server: { host: '127.0.0.1', port: 8765, strictPort: true },
    build: {
        write: false,
        minify: true,
        cssMinify: true,
        sourcemap: 'hidden',
        modulePreload: { polyfill: false },
        reportCompressedSize: false,
        rolldownOptions: { input: resolve(ROOT, 'src/viewer.html') },
    },
    test: {
        root: ROOT,
        include: ['tests/**/*.test.js'],
        testTimeout: 120000,
    },
    fmt: {
        printWidth: 120,
        singleQuote: true,
        semi: true,
        tabWidth: 4,
        useTabs: false,
        endOfLine: 'lf',
        ignorePatterns: [
            'data/**',
            'docs/**',
            'ida/**',
            '**/*.md',
            '**/*.json',
            '/viewer.html',
            '/viewer.html.map',
            'node_modules/**',
        ],
    },
    lint: {
        ignorePatterns: ['data/**', 'viewer.html', 'ida/**', 'node_modules/**'],
        options: { typeAware: true, typeCheck: true },
        categories: { correctness: 'error', suspicious: 'error' },
        rules: {
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                },
            ],
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'no-shadow': 'error',
            // helpers stay next to the code that uses them
            'unicorn/consistent-function-scoping': 'off',
        },
        overrides: [
            {
                // the type-aware rules the JavaScript scripts and tests are not held to
                files: ['scripts/**/*.js', 'tests/**/*.js'],
                rules: {
                    'typescript/no-misused-spread': 'off',
                    'typescript/require-array-sort-compare': 'off',
                },
            },
        ],
    },
});
