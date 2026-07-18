import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { withTimeout } from './async.ts';

interface NativeShareFileIO {
  writeFile(options: {
    path: string;
    data: string;
    directory: Directory;
    encoding?: Encoding;
    recursive?: boolean;
  }): Promise<unknown>;
  readFile(options: {
    path: string;
    directory: Directory;
    encoding?: Encoding;
  }): Promise<{ data: string | Blob }>;
  getUri(options: { path: string; directory: Directory }): Promise<{ uri: string }>;
}

export interface VerifiedNativeShareFileOptions {
  path: string;
  data: string;
  format: 'utf8' | 'base64';
  label: string;
  timeoutMs?: number;
}

export function assertExactNativeSharePayload(expected: string, actual: string | Blob, label: string): void {
  if (typeof actual !== 'string' || actual !== expected) {
    throw new Error(`${label} export verification failed: the native file did not match the complete prepared content. Nothing was shared.`);
  }
}

/**
 * Writes the exact native cache file that will be handed to the share sheet,
 * reads it back with the same encoding, and refuses to resolve a URI unless the
 * content matches byte-for-byte. This is the final app-controlled export gate.
 */
export async function prepareVerifiedNativeShareFile(
  options: VerifiedNativeShareFileOptions,
  io: NativeShareFileIO = Filesystem,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const encoding = options.format === 'utf8' ? Encoding.UTF8 : undefined;
  const fileOptions = {
    path: options.path,
    directory: Directory.Cache,
    ...(encoding ? { encoding } : {}),
  };

  await withTimeout(
    io.writeFile({ ...fileOptions, data: options.data, recursive: true }),
    timeoutMs,
    `Preparing the complete ${options.label} file timed out before verification.`,
  );
  const saved = await withTimeout(
    io.readFile(fileOptions),
    timeoutMs,
    `The ${options.label} file was written but could not be read back for verification. Nothing was shared.`,
  );
  assertExactNativeSharePayload(options.data, saved.data, options.label);

  const resolved = await withTimeout(
    io.getUri({ path: options.path, directory: Directory.Cache }),
    timeoutMs,
    `The verified ${options.label} file was written, but its share location could not be resolved in time.`,
  );
  if (!resolved.uri) throw new Error(`The verified ${options.label} file has no shareable location. Nothing was shared.`);
  return resolved.uri;
}
