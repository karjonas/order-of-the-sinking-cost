// Number helpers shared by the data scripts

export type Vector = [x: number, y: number, z: number];
export type Vector4 = [x: number, y: number, z: number, w: number];
export type Quaternion = Vector4;

// The value rounded to the given number of decimal places (halves away from zero, on the exact binary value)
export function roundTo(value: number, places: number): number {
    return Number(value.toFixed(places));
}

export function roundVector(vector: Vector, places: number): Vector {
    return [roundTo(vector[0], places), roundTo(vector[1], places), roundTo(vector[2], places)];
}

export function roundVector4(vector: Vector4, places: number): Vector4 {
    return [
        roundTo(vector[0], places),
        roundTo(vector[1], places),
        roundTo(vector[2], places),
        roundTo(vector[3], places),
    ];
}

// Lists of numbers by their first element, then their second, and so on
export function compareNumberLists(first: number[], second: number[]): number {
    for (let i = 0; i < first.length; i++) {
        if (first[i] !== second[i]) return first[i] - second[i];
    }
    return 0;
}

// The remainder of a floored division: it takes the sign of the divisor, so cells wrap into 0 .. divisor - 1
export function modulo(dividend: number, divisor: number): number {
    const remainder = dividend % divisor;
    if (remainder !== 0 && remainder < 0 !== divisor < 0) return remainder + divisor;
    return remainder;
}
