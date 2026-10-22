/** Helpers for showing build artifacts. Pure, so they can be tested without a browser. */

/**
 * A classic hexdump: offset, 16 bytes in hex, and the printable characters.
 * Only the first `limit` bytes are rendered.
 */
export function hexdump(bytes: Uint8Array, limit = 64 * 1024): string {
  const shown = Math.min(bytes.length, limit);
  const lines: string[] = [];
  for (let offset = 0; offset < shown; offset += 16) {
    const row = bytes.subarray(offset, Math.min(offset + 16, shown));
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0'));
    const left = hex.slice(0, 8).join(' ');
    const right = hex.slice(8).join(' ');
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${left.padEnd(23)}  ${right.padEnd(23)}  |${ascii}|`);
  }
  if (bytes.length > shown) lines.push(`… ${(bytes.length - shown).toLocaleString('en-US')} more bytes (download the file for the rest)`);
  return lines.join('\n');
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** What a binary artifact starts with, for a one-line summary above the bytes */
export function describeBinary(bytes: Uint8Array): string {
  const at = (...magic: number[]) => magic.every((b, i) => bytes[i] === b);
  if (at(0x7f, 0x45, 0x4c, 0x46)) return `ELF ${bytes[4] === 2 ? '64' : '32'}-bit ${bytes[5] === 2 ? 'big' : 'little'}-endian`;
  if (at(0x00, 0x61, 0x73, 0x6d)) return `WebAssembly module (version ${bytes[4]})`;
  if (at(0xcf, 0xfa, 0xed, 0xfe) || at(0xfe, 0xed, 0xfa, 0xcf)) return 'Mach-O 64-bit';
  if (at(0x4d, 0x5a)) return 'Windows PE executable';
  if (at(0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e)) return 'Static library (ar archive)';
  return 'Binary data';
}
