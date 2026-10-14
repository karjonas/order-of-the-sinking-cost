// Number helpers shared by the data scripts

// The value rounded to the given number of decimal places (halves away from zero, on the exact binary value)
export function roundTo(value, places) {
    return Number(value.toFixed(places));
}

// Lists of numbers by their first element, then their second, and so on
export function compareNumberLists(first, second) {
    for (let i = 0; i < first.length; i++) {
        if (first[i] !== second[i]) return first[i] - second[i];
    }
    return 0;
}

// The remainder of a floored division: it takes the sign of the divisor, so cells wrap into 0 .. divisor - 1
export function modulo(dividend, divisor) {
    const remainder = dividend % divisor;
    if (remainder !== 0 && remainder < 0 !== divisor < 0) return remainder + divisor;
    return remainder;
}
