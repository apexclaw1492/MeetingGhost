import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { idb } from '../utils/idb';
import { readSegment, segmentNativeUri } from '../utils/audioStore';
import { withTimeout } from '../utils/async';
import { resolvePlaybackSource } from '../utils/playbackSource';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5];

/* Plays a persisted recording.
   segments > 0: v10 segmented audio — parts play sequentially and auto-advance
   (each segment is an independent file; only one is in memory at a time).
   segments === 0: legacy v9 single blob stored under the plain meeting id. */
export function AudioPlayer({ meetingId, segments = 0, segmentIds, mimeType = 'audio/mp4' }:
  { meetingId: string; segments?: number; segmentIds?: number[]; mimeType?: string }) {
  const [part, setPart] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wasPlayingRef = useRef(false);
  const hasSegmentManifest = !!segmentIds?.length;
  const isSegmented = segments > 0 || hasSegmentManifest;
  const playableParts = hasSegmentManifest ? segmentIds.length : segments;

  useEffect(() => {
    // A repaired manifest or a newly selected meeting must never point at an
    // out-of-range old part. Restart from the first verified audio file.
    setPart(0);
    wasPlayingRef.current = false;
  }, [meetingId, segmentIds]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setLoadError('');
    const segment = segmentIds?.[part] ?? part;
    const loadBlob = async (): Promise<Blob | null> => {
      if (isSegmented) return readSegment(meetingId, segment, mimeType);
      return (await idb.get<Blob>('audio', meetingId).catch(() => null)) || null;
    };
    const load = () => resolvePlaybackSource({
      nativeSegmented: isSegmented && Capacitor.isNativePlatform(),
      loadNativeUri: () => segmentNativeUri(meetingId, segment),
      convertNativeUri: uri => Capacitor.convertFileSrc(uri),
      loadBlob,
      createObjectUrl: blob => URL.createObjectURL(blob),
    });
    withTimeout(load(), 15_000, `Audio part ${part + 1} did not load within 15 seconds.`).then(source => {
      if (cancelled) return;
      if (!source) {
        setLoadError(`Audio part ${part + 1} could not be loaded. The recording was not deleted; retry or export diagnostics.`);
        return;
      }
      objectUrl = source.revokeWhenDone ? source.url : null;
      setUrl(source.url);
    }).catch(error => {
      if (!cancelled) setLoadError(`Audio could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl); // one segment in memory at a time
    };
  }, [meetingId, part, isSegmented, segmentIds, mimeType, reload]);

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  if (loadError) {
    return (
      <div className="audio-player audio-player-error" role="alert">
        <span>{loadError}</span>
        <button className="btn-ghost speed-btn" onClick={() => setReload(value => value + 1)}>Retry Audio</button>
      </div>
    );
  }

  if (!url) return <div className="audio-player"><span>Loading saved audio…</span></div>;

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        src={url}
        controls
        preload="metadata"
        onPlay={() => { wasPlayingRef.current = true; if (audioRef.current) audioRef.current.playbackRate = speed; }}
        onPause={() => { if (audioRef.current && audioRef.current.ended === false) wasPlayingRef.current = false; }}
        onLoadedMetadata={() => {
          if (wasPlayingRef.current && audioRef.current) {
            audioRef.current.playbackRate = speed;
            audioRef.current.play().catch(() => { /* autoplay blocked — user taps play */ });
          }
        }}
        onError={() => setLoadError(`Audio part ${part + 1} could not be decoded. The original saved file remains intact.`)}
        onEnded={() => {
          if (playableParts > 0 && part + 1 < playableParts) setPart(p => p + 1); // auto-advance
          else wasPlayingRef.current = false;
        }}
      />
      {playableParts > 1 && <span className="part-label">{part + 1}/{playableParts}</span>}
      <button className="btn-ghost speed-btn" onClick={cycleSpeed} title="Playback speed">
        {speed}x
      </button>
    </div>
  );
}
