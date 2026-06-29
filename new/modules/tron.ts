import { createHash } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const isTronAddress = (v: string): boolean => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v);

const sha256 = (d: Uint8Array): Buffer => createHash("sha256").update(d).digest();

function base58Encode(bytes: Uint8Array): string {
    let n = 0n;
    for (const b of bytes) n = n * 256n + BigInt(b);
    let out = "";
    while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
    return out;
}

function base58Decode(str: string): Buffer {
    let n = 0n;
    for (const c of str) {
        const i = ALPHABET.indexOf(c);
        if (i < 0) throw new Error(`Caractère Base58 invalide: ${c}`);
        n = n * 58n + BigInt(i);
    }
    const bytes: number[] = [];
    while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
    for (const c of str) { if (c !== "1") break; bytes.unshift(0); }
    return Buffer.from(bytes);
}

export function tronBase58ToEvmHex(base58: string): string {
    const d = base58Decode(base58);
    if (d.length !== 25 || d[0] !== 0x41) throw new Error(`Adresse TRON invalide: ${base58}`);
    return "0x" + d.subarray(1, 21).toString("hex");
}

export function evmHexToTronBase58(hex: string): string {
    const clean = hex.toLowerCase().replace(/^0x/, "").padStart(40, "0").slice(-40);
    const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(clean, "hex")]);
    const checksum = sha256(sha256(payload)).subarray(0, 4);
    return base58Encode(Buffer.concat([payload, checksum]));
}
