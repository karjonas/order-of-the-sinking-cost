// Access to decoded entity fields (objects keyed by field name) with a fallback for a field the blob does not hold

// The field's value as decoded, else the fallback
export function get(fields, key, fallback) {
    if (key in fields) return fields[key];
    return fallback;
}

// The entity id an id field names: the pid inside an [id text, pid] pair, 0 for none
export function refOf(value) {
    if (Array.isArray(value)) return value[1];
    return value || 0;
}

// A field's list of enum flag names (empty when the field is missing or holds no flags)
export function flagsOf(fields, key) {
    const value = fields[key];
    if (Array.isArray(value)) return value;
    return [];
}
