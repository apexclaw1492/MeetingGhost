/** Convert bounded little-endian PCM16 returned by the native decoder. */
export function pcm16Base64ToFloat32(base64: string, expectedSamples?: number): Float32Array {
  if (!base64) throw new Error('Native audio decoder returned no PCM data.');
  const binary = atob(base64);
  if (binary.length % 2 !== 0) throw new Error('Native PCM payload has an invalid byte length.');
  const samples = binary.length / 2;
  if (expectedSamples != null && samples !== expectedSamples) {
    throw new Error(`Native PCM verification failed: expected ${expectedSamples} samples, received ${samples}.`);
  }
  const output = new Float32Array(samples);
  for (let index = 0; index < samples; index++) {
    const low = binary.charCodeAt(index * 2);
    const high = binary.charCodeAt(index * 2 + 1);
    const unsigned = low | (high << 8);
    const signed = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
    output[index] = signed / 32768;
  }
  return output;
}
