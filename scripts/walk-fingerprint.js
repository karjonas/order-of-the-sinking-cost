// Writes a canonical fingerprint of everything the overworld walk computes for one input, or compares two fingerprints.
// A fingerprint names each walk output (the reached cells, the pockets, the pad linkage, the level states and plans, ...)
// with a short hash, so a change to the walk that should change no answer can be checked, and a difference names the
// field. Two runs on the same input give the same bytes.
//
// Reads the saves in place and writes only <outFile>. The fields and the inputs: scripts/lib/walk-fingerprint.js.
//
// Usage:
//   node scripts/walk-fingerprint.js <input> <outFile>
//   node scripts/walk-fingerprint.js --diff <fingerprintA> <fingerprintB>
//   input: a campaign folder, or the name of a campaign in the saves folder; --fresh (a new campaign walked from its
//     start); --no-history (the level data alone); --static-roles
//
// --diff prints the fields that differ, with where, and exits 1 when there are any.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    diffFingerprints,
    fingerprintOf,
    fingerprintText,
    freshCampaign,
    noHistoryOutputs,
    readSaveFolder,
    saveFolderOf,
    saveOutputs,
    staticRolesOutputs,
    walkLoaded,
} from './lib/walk-fingerprint.js';

const USAGE = [
    'Usage: node scripts/walk-fingerprint.js <input> <outFile>',
    '       node scripts/walk-fingerprint.js --diff <fingerprintA> <fingerprintB>',
    '  input: <saveFolder|campaign> | --fresh | --no-history | --static-roles',
].join('\n');

function outputsOf(input) {
    if (input === '--fresh') {
        const { status, history } = freshCampaign();
        return saveOutputs(status, history);
    }
    if (input === '--no-history') return noHistoryOutputs();
    if (input === '--static-roles') return staticRolesOutputs();

    const { status, history } = readSaveFolder(saveFolderOf(input));
    return saveOutputs(status, history);
}

async function writeFingerprint(input, outFile) {
    await walkLoaded();

    const started = performance.now();
    const fingerprint = fingerprintOf(outputsOf(input));
    const elapsed = performance.now() - started;

    writeFileSync(outFile, fingerprintText(fingerprint));
    const fieldCount = Object.keys(fingerprint.hashes).length;
    console.log(`${outFile}: ${fieldCount} fields, digest ${fingerprint.digest}, walked in ${elapsed.toFixed(0)} ms`);
}

function diff(firstFile, secondFile) {
    const first = JSON.parse(readFileSync(firstFile, 'utf8'));
    const second = JSON.parse(readFileSync(secondFile, 'utf8'));
    const lines = diffFingerprints(first, second);

    if (lines.length === 0) {
        console.log(`identical: ${Object.keys(first.hashes).length} fields, digest ${first.digest}`);
        return;
    }

    console.log(lines.join('\n'));
    process.exitCode = 1;
}

async function main() {
    const [first, second, third] = process.argv.slice(2);

    if (first === '--diff' && second && third) {
        diff(resolve(second), resolve(third));
    } else if (first && second && !third && first !== '--diff') {
        await writeFingerprint(first, resolve(second));
    } else {
        console.error(USAGE);
        process.exitCode = 2;
    }
}

await main();
