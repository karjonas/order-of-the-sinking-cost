// Writing the data files: through a temporary file in the same folder, so a reader never sees half a file
import { renameSync, writeFileSync } from 'node:fs';

export function writeTextAtomic(path: string, text: string): void {
    const temporary = path + '.tmp';
    writeFileSync(temporary, text, 'utf8');
    renameSync(temporary, path);
}

declare global {
    interface JSON {
        rawJSON(text: string): object;
    }
}

// Maps are written as objects and BigInts (64-bit fields beyond a double's integers) as their exact digits
function toJsonValue(_key: string, value: unknown): unknown {
    if (value instanceof Map) return Object.fromEntries(value);
    if (typeof value === 'bigint') return JSON.rawJSON(value.toString());
    return value;
}

// JSON with LF line breaks: compact, or indented by `indent` spaces for the files people read
export function writeJsonAtomic(path: string, value: unknown, { indent = 0 }: { indent?: number } = {}): void {
    writeTextAtomic(path, JSON.stringify(value, toJsonValue, indent) + '\n');
}
