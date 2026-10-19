// Plain JSON values and the typed arrays that the model dumps turn into them

/** A plain value: what JSON holds. */
export type Canonical = null | string | number | boolean | Canonical[] | { [key: string]: Canonical };

export type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array
    | BigInt64Array
    | BigUint64Array;

// Whether a value is a typed array: a view of numbers (or, for the 64-bit kinds, bigints), not a DataView
export function isTypedArray(value: object): value is TypedArray {
    return ArrayBuffer.isView(value) && !(value instanceof DataView);
}
