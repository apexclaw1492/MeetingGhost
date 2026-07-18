export interface PlaybackSource {
  url: string;
  revokeWhenDone: boolean;
}

export interface PlaybackSourceOptions {
  nativeSegmented: boolean;
  loadNativeUri: () => Promise<string | null>;
  convertNativeUri: (uri: string) => string;
  loadBlob: () => Promise<Blob | null>;
  createObjectUrl: (blob: Blob) => string;
}

/**
 * Native segmented recordings, including hours-long single-file imports, must
 * stream from the app container. Reading them as base64 would duplicate the
 * complete file inside the WebView and can exhaust memory before playback.
 */
export async function resolvePlaybackSource(options: PlaybackSourceOptions): Promise<PlaybackSource | null> {
  if (options.nativeSegmented) {
    const uri = await options.loadNativeUri();
    if (!uri) return null;
    const converted = options.convertNativeUri(uri);
    return converted ? { url: converted, revokeWhenDone: false } : null;
  }

  const blob = await options.loadBlob();
  if (!blob) return null;
  return { url: options.createObjectUrl(blob), revokeWhenDone: true };
}
