// Little-endian binary reader over a byte buffer, shared by the save readers and the data scripts
const UTF8 = new TextDecoder();

/** Reads numbers, strings and byte runs in order from `offset` to `end` of a buffer. */
export class Reader {
    data: Uint8Array;
    view: DataView;
    position: number;
    end: number;

    constructor(buffer: Uint8Array | ArrayBuffer, offset = 0, end?: number) {
        this.data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
        this.position = offset;
        this.end = end ?? this.data.byteLength;
    }

    /** Throws unless `count` more bytes can be read. */
    need(count: number): void {
        if (count < 0 || this.position + count > this.end) {
            throw new Error(`read of ${count} bytes at ${this.position} past end ${this.end}`);
        }
    }

    u8(): number {
        this.need(1);
        const value = this.view.getUint8(this.position);
        this.position += 1;
        return value;
    }

    s8(): number {
        this.need(1);
        const value = this.view.getInt8(this.position);
        this.position += 1;
        return value;
    }

    u16(): number {
        this.need(2);
        const value = this.view.getUint16(this.position, true);
        this.position += 2;
        return value;
    }

    u32(): number {
        this.need(4);
        const value = this.view.getUint32(this.position, true);
        this.position += 4;
        return value;
    }

    s32(): number {
        this.need(4);
        const value = this.view.getInt32(this.position, true);
        this.position += 4;
        return value;
    }

    f32(): number {
        this.need(4);
        const value = this.view.getFloat32(this.position, true);
        this.position += 4;
        return value;
    }

    s64(): bigint {
        this.need(8);
        const value = this.view.getBigInt64(this.position, true);
        this.position += 8;
        return value;
    }

    /** A signed 64-bit count or length, as a number; throws for one beyond the safe integers. */
    n64(): number {
        const value = this.s64();
        if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error(`count ${value} too large at ${this.position - 8}`);
        }

        return Number(value);
    }

    skip(count: number): void {
        this.need(count);
        this.position += count;
    }

    bytes(count: number): Uint8Array {
        this.need(count);
        const value = this.data.subarray(this.position, this.position + count);
        this.position += count;
        return value;
    }

    str(length: number): string {
        return UTF8.decode(this.bytes(length));
    }

    /** A string with a 16-bit length prefix. */
    str16(): string {
        return this.str(this.u16());
    }

    /** A string with a 64-bit length prefix. */
    str64(): string {
        return this.str(this.n64());
    }

    /** The bytes not read yet. */
    get left(): number {
        return this.end - this.position;
    }
}
