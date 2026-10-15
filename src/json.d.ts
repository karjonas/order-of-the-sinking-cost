// The data files the page imports, typed as docs/DATAFILES.md describes them

declare module '*/schema.json' {
    const schema: import('./types.ts').Schema;
    export default schema;
}

declare module '*/progress.json' {
    const progress: import('./types.ts').Progress;
    export default progress;
}

declare module '*/walk.json' {
    const walk: import('./types.ts').WalkFile;
    export default walk;
}
