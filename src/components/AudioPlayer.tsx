import { useEffect, useRef, useState } from 'react';
import { idb } from '../utils/idb';
import { readSegment } from '../utils/audioStore';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5];

/* Plays a persisted recording.
   segments > 0: v10 segmented audio — parts play sequentially and auto-advance
   (each segment is an independent file; only one is in memory at a time).
   segments === 0: legacy v9 single blob stored under the plain meeting id. */
export function AudioPlayer({ meetingId, segments = 0, mimeType = 'audio/mp4' }:
  { meetingId: string; segments?: number; mimeType?: string }) {
  const [part, setPart] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    const load = async (): Promise<Blob | null> => {
      if (segments > 0) return readSegment(meetingId, part, mimeType);
      return (await idb.get<Blob>('audio', meetingId).catch(() => null)) || null;
    };
    load().then(blob => {
      if (!blob || cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl); // one segment in memory at a time
    };
  }, [meetingId, part, segments, mimeType]);

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  if (!url) return null;

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
        onEnded={() => {
          if (segments > 0 && part + 1 < segments) setPart(p => p + 1); // auto-advance
          else wasPlayingRef.current = false;
        }}
      />
      {segments > 1 && <span className="part-label">{part + 1}/{segments}</span>}
      <button className="btn-ghost speed-btn" onClick={cycleSpeed} title="Playback speed">
        {speed}x
      </button>
    </div>
  );
}
