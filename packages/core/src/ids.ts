import { randomBytes as nodeRandomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * ULID (26 Crockford base32 characters): 48-bit millisecond timestamp followed
 * by 80 random bits. Lexicographically sortable by creation time.
 */
export function ulid(
  now: Date = new Date(),
  random: (size: number) => Uint8Array = nodeRandomBytes,
): string {
  let time = now.getTime();
  if (!Number.isSafeInteger(time) || time < 0 || time > 0xffffffffffff) {
    throw new RangeError("timestamp out of ULID range");
  }
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[time % 32] + timePart;
    time = Math.floor(time / 32);
  }

  const bytes = random(10);
  if (bytes.length !== 10) throw new RangeError("random source must return 10 bytes");
  let randomPart = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      randomPart += CROCKFORD[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return timePart + randomPart;
}

export function newContextId(now?: Date, random?: (size: number) => Uint8Array): string {
  return `ctx_${ulid(now, random)}`;
}

export function newVariantId(now?: Date, random?: (size: number) => Uint8Array): string {
  return `var_${ulid(now, random)}`;
}
