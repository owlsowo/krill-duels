/** A fresh cryptographic Fisher–Yates shuffle, generated only by the room host. */
export function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const range = i + 1;
    const limit = Math.floor(0x1_0000_0000 / range) * range;
    const buffer = new Uint32Array(1);
    do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
    const j = buffer[0] % range;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
