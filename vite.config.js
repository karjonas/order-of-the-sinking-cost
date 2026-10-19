import { createReadStream, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { defineConfig } from 'vite-plus';
import { savesDir } from './scripts/saves.js';

const ROOT = import.meta.dirname;
const DIST = resolve(ROOT, 'dist');

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

// The page's script is a classic script loaded with defer, which also runs when viewer.html is opened from disk, where
// browsers refuse module scripts. The bundle has no imports or exports, and a banner and footer wrap it in a function;
// the iife format would put the styles in the script instead of viewer.css. Vite writes the script as a module script
// and the styles with crossorigin attributes.
function classicScript() {
    return {
        name: 'soko:classic-script',
        apply: 'build',
        transformIndexHtml: {
            order: 'post',
            handler(html) {
                return html
                    .replace(
                        /<script type="module" crossorigin src="[^"]*viewer\.js"><\/script>/,
                        '<script defer src="viewer.js"></script>',
                    )
                    .replace(/(<link rel="stylesheet") crossorigin /, '$1 ');
            },
        },
    };
}

// The build has exactly one script, and its source map lists the sources relative to the repository, with the contents
// of the JSON data files left out
function scriptMap() {
    return {
        name: 'soko:script-map',
        apply: 'build',
        enforce: 'post',
        generateBundle(options, bundle) {
            const scripts = Object.values(bundle).filter((output) => output.type === 'chunk');
            if (scripts.length !== 1 || !scripts[0].map) {
                const names = scripts.map((script) => script.fileName).join(', ');
                this.error(`expected one script with a source map, got ${names}`);
            }

            const map = scripts[0].map;
            const outDir = options.dir || DIST;
            map.sources = map.sources.map((source) => relative(ROOT, resolve(outDir, source)).replace(/\\/g, '/'));
            map.sourcesContent = map.sourcesContent.map((content, index) => {
                if (map.sources[index].endsWith('.json')) return null;
                return content;
            });

            const file = bundle[`${scripts[0].fileName}.map`];
            if (file) file.source = JSON.stringify(map);
        },
    };
}

// Fixed file names, so publishing the build again overwrites the same paths
function assetFileName(asset) {
    const name = asset.names?.[0] ?? asset.name ?? '';
    if (name.endsWith('.css')) return 'viewer.css';
    return 'assets/[name][extname]';
}

export default defineConfig({
    root: resolve(ROOT, 'src'),
    base: './',
    publicDir: resolve(ROOT, 'public'),
    plugins: [saves(), schemaForPage(), classicScript(), scriptMap()],
    json: { namedExports: false, stringify: true },
    server: { host: '127.0.0.1', port: 8765, strictPort: true },
    build: {
        outDir: DIST,
        emptyOutDir: true,
        // the script is minified in rolldownOptions below, keeping its names
        minify: false,
        cssMinify: true,
        sourcemap: true,
        modulePreload: { polyfill: false },
        reportCompressedSize: false,
        rolldownOptions: {
            input: resolve(ROOT, 'src/viewer.html'),
            output: {
                format: 'es',
                banner: '(function () {',
                footer: '})();',
                minify: { compress: true, mangle: false, codegen: { removeWhitespace: true } },
                entryFileNames: 'viewer.js',
                chunkFileNames: 'viewer-[name].js',
                assetFileNames: assetFileName,
            },
        },
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
        ignorePatterns: ['data/**', 'docs/**', 'ida/**', '**/*.md', '**/*.json', 'dist/**', 'node_modules/**'],
    },
    lint: {
        ignorePatterns: ['data/**', 'dist/**', 'ida/**', 'node_modules/**'],
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
