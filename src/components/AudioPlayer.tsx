import { useEffect, useRef, useState } from 'react';
import { idb } from '../utils/idb';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5];

/* Plays a recording persisted in IndexedDB under the meeting id. */
export function AudioPlayer({ meetingId }: { meetingId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    idb.get<Blob>('audio', meetingId).then(blob => {
      if (!blob || cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { /* no recording stored */ });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meetingId]);

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
        onPlay={() => { if (audioRef.current) audioRef.current.playbackRate = speed; }}
      />
      <button className="btn-ghost speed-btn" onClick={cycleSpeed} title="Playback speed">
        {speed}x
      </button>
    </div>
  );
}
