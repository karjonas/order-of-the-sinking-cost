// Writing the data files: through a temporary file in the same folder, so a reader never sees half a file
import { renameSync, writeFileSync } from 'node:fs';

export function writeTextAtomic(path, text) {
    const temporary = path + '.tmp';
    writeFileSync(temporary, text, 'utf8');
    renameSync(temporary, path);
}

// Maps are written as objects and BigInts (64-bit fields beyond a double's integers) as their exact digits
function toJsonValue(_key, value) {
    if (value instanceof Map) return Object.fromEntries(value);
    if (typeof value === 'bigint') return JSON.rawJSON(value.toString());
    return value;
}

// JSON with LF line breaks: compact, or indented by `indent` spaces for the files people read
export function writeJsonAtomic(path, value, { indent = 0 } = {}) {
    writeTextAtomic(path, JSON.stringify(value, toJsonValue, indent) + '\n');
}
