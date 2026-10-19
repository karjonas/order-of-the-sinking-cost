import { createReadStream, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite-plus';
import type { Schema } from './src/types.ts';
import { savesDir } from './scripts/saves.ts';

const ROOT = import.meta.dirname;
const DIST = resolve(ROOT, 'dist');

// The dev server opens the page at /, and /saves/<campaign>/<file> reads the game's save folder: GET and HEAD only, and anything that
// resolves outside the folder (backslashes, drive letters, ..) is not found
function saves(): Plugin {
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
                let full: string | null = null;
                try {
                    const base = realpathSync.native(savesDir());
                    const rel = decodeURIComponent(new URL(req.url ?? '', 'http://x').pathname);
                    const p = realpathSync.native(resolve(base, ...rel.split('/').filter(Boolean)));
                    if ((p === base || p.startsWith(base + sep)) && statSync(p).isFile()) full = p;
                } catch {}
                if (!full) {
                    res.statusCode = 404;
                    res.end();
                    return;
                }
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Content-Length', String(statSync(full).size));
                res.setHeader('Cache-Control', 'no-store');
                if (req.method === 'HEAD') res.end();
                else createReadStream(full).pipe(res);
            });
        },
    };
}

// the schema's field notes and addresses are for the docs only
function schemaForPage(): Plugin {
    return {
        name: 'soko:schema',
        enforce: 'pre',
        transform(code, id) {
            if (!id.replace(/\\/g, '/').endsWith('/data/schema.json')) return null;
            const schema: Schema = JSON.parse(code);
            const fieldLists = [schema.base.fields];
            for (const type of Object.values(schema.types)) {
                if (type.fields) fieldLists.push(type.fields);
            }
            for (const lst of fieldLists)
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
function classicScript(): Plugin {
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
function scriptMap(): Plugin {
    return {
        name: 'soko:script-map',
        apply: 'build',
        enforce: 'post',
        generateBundle(options, bundle) {
            const scripts = Object.values(bundle).filter((output) => output.type === 'chunk');
            const script = scripts[0];
            if (scripts.length !== 1 || !script.map) {
                const names = scripts.map((chunk) => chunk.fileName).join(', ');
                this.error(`expected one script with a source map, got ${names}`);
            }

            const map = script.map;
            const outDir = options.dir || DIST;
            map.sources = map.sources.map((source) => relative(ROOT, resolve(outDir, source)).replace(/\\/g, '/'));
            const sourcesContent = map.sourcesContent.map((content, index) => {
                if (map.sources[index].endsWith('.json')) return null;
                return content;
            });
            Object.assign(map, { sourcesContent });

            const file = bundle[`${script.fileName}.map`];
            if (file && file.type === 'asset') file.source = JSON.stringify(map);
        },
    };
}

// Fixed file names, so publishing the build again overwrites the same paths
function assetFileName(asset: { names?: string[]; name?: string }): string {
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
        include: ['tests/**/*.test.{js,ts}'],
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
                files: ['scripts/**/*.{js,ts}', 'tests/**/*.{js,ts}', 'vite.config.ts'],
                rules: {
                    'typescript/no-misused-spread': 'off',
                    'typescript/require-array-sort-compare': 'off',
                },
            },
        ],
    },
});
