package com.meetingghost.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;

/**
 * Foreground-service-owned segmented capture. Audio is written directly to
 * filesDir/recordings/<meetingId>/seg-n.partial and atomically renamed to seg-n
 * only after MediaRecorder closes it and the byte length is verified. The
 * WebView may suspend or reload without owning the microphone or segment timer.
 */
public class RecordingSessionService extends Service {
    public static final String ACTION_START = "com.meetingghost.app.recording.START";
    public static final String ACTION_STOP = "com.meetingghost.app.recording.STOP";
    public static final String ACTION_FLUSH = "com.meetingghost.app.recording.FLUSH";
    public static final String ACTION_EVENT = "com.meetingghost.app.recording.EVENT";
    public static final String EXTRA_EVENT = "event";
    public static final String PREFS = "meetingghost_native_recording";

    private static final String CHANNEL_ID = "meetingghost_recording";
    private static final int NOTIFICATION_ID = 1201;
    private static final long DEFAULT_WARN_BYTES = 500L * 1024 * 1024;
    private static final long DEFAULT_STOP_BYTES = 100L * 1024 * 1024;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayList<Integer> segmentIds = new ArrayList<>();
    private final ArrayList<Integer> failedSegments = new ArrayList<>();
    private MediaRecorder recorder;
    private File recordingDirectory;
    private File partialFile;
    private String meetingId;
    private int nextSegment;
    private int segmentSeconds = 15;
    private long warnBytes = DEFAULT_WARN_BYTES;
    private long stopBytes = DEFAULT_STOP_BYTES;
    private long totalBytes;
    private long recordedMs;
    private long segmentStartedElapsed;
    private boolean active;
    private boolean stopping;
    private PowerManager.WakeLock wakeLock;
    private AudioManager audioManager;
    private final AudioManager.OnAudioFocusChangeListener focusListener = focusChange -> handler.post(() -> {
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            terminalStop("Android audio focus was interrupted; completed segments are safe.");
        }
    });

    private final Runnable rotateRunnable = () -> {
        if (active && !stopping) finalizeSegment(true);
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        PowerManager manager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MeetingGhost:NativeRecording");
        wakeLock.setReferenceCounted(false);
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundCompat(buildNotification("Preparing native audio capture…"));
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            // A recovery STOP can be the first command delivered to a newly
            // recreated process. Rehydrate the authoritative meeting/manifest
            // before persisting inactive state, or empty Java fields would
            // erase the last durable recovery response even though audio files
            // survived on disk.
            if (!active) restorePersistedSessionForControl();
            stopSession(null, false);
            return START_NOT_STICKY;
        }
        if (ACTION_FLUSH.equals(action)) {
            if (active && elapsedCurrentMs() >= 500) finalizeSegment(true);
            broadcast("flushed", null);
            return START_STICKY;
        }
        if (ACTION_START.equals(action)) {
            String requestedMeetingId = intent.getStringExtra("meetingId");
            if (active) {
                if (meetingId != null && meetingId.equals(requestedMeetingId)) broadcast("started", null);
                else broadcast("error", "Another native meeting recording is already active.");
                return START_STICKY;
            }
            meetingId = requestedMeetingId;
            segmentSeconds = Math.max(5, Math.min(60, intent.getIntExtra("segmentSeconds", 15)));
            warnBytes = Math.max(0, intent.getLongExtra("warnBytes", DEFAULT_WARN_BYTES));
            stopBytes = Math.max(0, intent.getLongExtra("stopBytes", DEFAULT_STOP_BYTES));
            beginSession();
            return START_STICKY;
        }

        // Android may recreate a killed foreground service with a null intent.
        // Resume only a session explicitly persisted as active; any .partial
        // tail from the killed recorder is deleted before a new segment starts.
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean("active", false)) {
            meetingId = prefs.getString("meetingId", null);
            segmentSeconds = prefs.getInt("segmentSeconds", 15);
            warnBytes = prefs.getLong("warnBytes", DEFAULT_WARN_BYTES);
            stopBytes = prefs.getLong("stopBytes", DEFAULT_STOP_BYTES);
            beginSession();
            return START_STICKY;
        }
        stopForeground(true);
        stopSelf();
        return START_NOT_STICKY;
    }

    private void beginSession() {
        try {
            if (meetingId == null || !meetingId.matches("[A-Za-z0-9_-]+")) {
                throw new IOException("A safe meetingId is required.");
            }
            recordingDirectory = new File(getFilesDir(), "recordings/" + meetingId);
            if (!recordingDirectory.exists() && !recordingDirectory.mkdirs()) {
                throw new IOException("Could not create the private recording directory.");
            }
            RecordingRecoveryFiles.discardPartials(recordingDirectory);
            loadCompletedSegments();
            nextSegment = segmentIds.isEmpty() ? 0 : Collections.max(segmentIds) + 1;
            totalBytes = RecordingRecoveryFiles.totalBytes(recordingDirectory, segmentIds);
            SharedPreferences prior = getSharedPreferences(PREFS, MODE_PRIVATE);
            recordedMs = meetingId.equals(prior.getString("meetingId", null)) ? prior.getLong("recordedMs", 0) : 0;
            failedSegments.clear();
            stopping = false;
            active = true;
            if (!wakeLock.isHeld()) wakeLock.acquire();
            requestAudioFocus();
            startSegment();
            persistStatus(null);
            startForegroundCompat(buildNotification("Saving audio in verified 15-second segments"));
            broadcast("started", null);
        } catch (Exception error) {
            active = false;
            persistStatus(error.getMessage());
            broadcast("error", "Could not start native recording: " + error.getMessage());
            releaseResources();
            stopForeground(true);
            stopSelf();
        }
    }

    @SuppressWarnings("deprecation")
    private void startSegment() throws IOException {
        if (!active || recordingDirectory == null) return;
        partialFile = new File(recordingDirectory, "seg-" + nextSegment + ".partial");
        if (partialFile.exists() && !partialFile.delete()) throw new IOException("Could not discard an old partial segment.");
        MediaRecorder nextRecorder = new MediaRecorder();
        nextRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
        nextRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        nextRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
        nextRecorder.setAudioChannels(1);
        nextRecorder.setAudioSamplingRate(44_100);
        nextRecorder.setAudioEncodingBitRate(64_000);
        nextRecorder.setOutputFile(partialFile.getAbsolutePath());
        nextRecorder.setOnErrorListener((ignored, what, extra) ->
            handler.post(() -> terminalStop("The Android recorder reported error " + what + "/" + extra + "; completed segments are safe."))
        );
        try {
            nextRecorder.prepare();
            nextRecorder.start();
        } catch (Exception error) {
            nextRecorder.reset();
            nextRecorder.release();
            throw error instanceof IOException ? (IOException) error : new IOException(error);
        }
        recorder = nextRecorder;
        segmentStartedElapsed = SystemClock.elapsedRealtime();
        handler.removeCallbacks(rotateRunnable);
        handler.postDelayed(rotateRunnable, segmentSeconds * 1000L);
    }

    private void finalizeSegment(boolean startNext) {
        handler.removeCallbacks(rotateRunnable);
        MediaRecorder current = recorder;
        File partial = partialFile;
        recorder = null;
        partialFile = null;
        if (current == null || partial == null) {
            if (startNext && active) tryStartNextOrStop();
            return;
        }
        int segment = nextSegment;
        long durationMs = elapsedCurrentMs();
        boolean stopped = false;
        try {
            current.stop();
            stopped = true;
        } catch (RuntimeException ignored) {
            // MediaRecorder throws when no valid frames reached the muxer.
        } finally {
            current.reset();
            current.release();
        }

        try {
            long size = partial.exists() ? partial.length() : 0;
            if (!stopped || durationMs < 250 || size <= 0) {
                if (partial.exists()) partial.delete();
            } else {
                File complete = new File(recordingDirectory, "seg-" + segment);
                if (complete.exists() && !complete.delete()) throw new IOException("Could not replace a stale completed segment.");
                if (!partial.renameTo(complete)) throw new IOException("Could not atomically commit the recorded segment.");
                long verified = complete.length();
                if (verified != size) throw new IOException("Committed segment byte verification failed.");
                segmentIds.add(segment);
                Collections.sort(segmentIds);
                totalBytes += verified;
                recordedMs += durationMs;
                nextSegment = segment + 1;
                persistStatus(null);
                broadcastSegmentSaved(segment, verified, durationMs);
                long free = getFilesDir().getUsableSpace();
                if (free < stopBytes && active && !stopping) {
                    terminalStop("Storage critically low — recording stopped safely; every completed segment is saved.");
                    return;
                }
                if (free < warnBytes) broadcastStorageWarning(free);
            }
        } catch (Exception error) {
            failedSegments.add(segment);
            if (partial.exists()) partial.delete();
            nextSegment = segment + 1;
            persistStatus(error.getMessage());
            broadcast("segmentError", "Segment " + (segment + 1) + " could not be committed: " + error.getMessage());
        }
        if (startNext && active) tryStartNextOrStop();
    }

    private void tryStartNextOrStop() {
        try { startSegment(); }
        catch (Exception error) { terminalStop("The native recorder could not continue: " + error.getMessage()); }
    }

    private void terminalStop(String reason) {
        if (!active) return;
        broadcast("interrupted", reason);
        stopSession(reason, true);
    }

    private void stopSession(String reason, boolean automatic) {
        if (stopping) return;
        stopping = true;
        if (recorder != null) finalizeSegment(false);
        active = false;
        persistStatus(reason);
        if (automatic) broadcast("autoStopped", reason);
        else broadcast("stopped", reason);
        releaseResources();
        stopping = false;
        stopForeground(true);
        stopSelf();
    }

    private long elapsedCurrentMs() {
        return segmentStartedElapsed <= 0 ? 0 : Math.max(0, SystemClock.elapsedRealtime() - segmentStartedElapsed);
    }

    private void loadCompletedSegments() {
        segmentIds.clear();
        segmentIds.addAll(RecordingRecoveryFiles.completedSegmentIds(recordingDirectory));
    }

    /** Restore enough state to safely service STOP after process death. */
    private void restorePersistedSessionForControl() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!prefs.getBoolean("active", false)) return;
        meetingId = prefs.getString("meetingId", null);
        segmentSeconds = prefs.getInt("segmentSeconds", 15);
        warnBytes = prefs.getLong("warnBytes", DEFAULT_WARN_BYTES);
        stopBytes = prefs.getLong("stopBytes", DEFAULT_STOP_BYTES);
        active = true;
        RecordingRecoveryFiles.Snapshot snapshot = RecordingRecoveryFiles.restoreSnapshot(
            getFilesDir(),
            meetingId,
            prefs.getLong("recordedMs", 0),
            prefs.getString("failedSegments", "")
        );
        recordingDirectory = snapshot.directory;
        segmentIds.clear();
        segmentIds.addAll(snapshot.segmentIds);
        failedSegments.clear();
        failedSegments.addAll(snapshot.failedSegments);
        totalBytes = snapshot.totalBytes;
        recordedMs = snapshot.recordedMs;
        nextSegment = snapshot.nextSegment;
    }

    private void releaseResources() {
        handler.removeCallbacks(rotateRunnable);
        if (recorder != null) {
            try { recorder.reset(); } catch (Exception ignored) { }
            recorder.release();
            recorder = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        abandonAudioFocus();
    }

    @SuppressWarnings("deprecation")
    private void requestAudioFocus() {
        if (audioManager == null) return;
        audioManager.requestAudioFocus(
            focusListener,
            AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
        );
    }

    @SuppressWarnings("deprecation")
    private void abandonAudioFocus() {
        if (audioManager != null) audioManager.abandonAudioFocus(focusListener);
    }

    private void broadcastSegmentSaved(int segment, long bytes, long ms) {
        Intent event = statusIntent("segmentSaved", null);
        event.putExtra("seg", segment);
        event.putExtra("bytes", bytes);
        event.putExtra("ms", ms);
        event.putExtra("freeBytes", getFilesDir().getUsableSpace());
        sendBroadcast(event);
    }

    private void broadcastStorageWarning(long freeBytes) {
        Intent event = statusIntent("storageWarning", null);
        event.putExtra("freeBytes", freeBytes);
        sendBroadcast(event);
    }

    @Override
    public void onTrimMemory(int level) {
        if (active) {
            Intent event = statusIntent("memoryPressure", null);
            event.putExtra("memoryPressureLevel", level);
            event.putExtra("freeBytes", getFilesDir().getUsableSpace());
            sendBroadcast(event);
        }
        super.onTrimMemory(level);
    }

    private void broadcast(String eventName, String message) {
        sendBroadcast(statusIntent(eventName, message));
    }

    private Intent statusIntent(String eventName, String message) {
        Intent event = new Intent(ACTION_EVENT).setPackage(getPackageName());
        event.putExtra(EXTRA_EVENT, eventName);
        putStatusExtras(event, message);
        return event;
    }

    private void putStatusExtras(Intent intent, String message) {
        intent.putExtra("active", active);
        intent.putExtra("meetingId", meetingId);
        intent.putExtra("segmentIds", toIntArray(segmentIds));
        intent.putExtra("failedSegments", toIntArray(failedSegments));
        intent.putExtra("totalBytes", totalBytes);
        intent.putExtra("recordedMs", recordedMs + (active && recorder != null ? elapsedCurrentMs() : 0));
        intent.putExtra("mimeType", "audio/mp4");
        if (message != null) {
            intent.putExtra("error", message);
            intent.putExtra("reason", message);
        }
    }

    private void persistStatus(String error) {
        SharedPreferences.Editor editor = getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putBoolean("active", active)
            .putString("meetingId", meetingId)
            .putString("segmentIds", join(segmentIds))
            .putString("failedSegments", join(failedSegments))
            .putLong("totalBytes", totalBytes)
            .putLong("recordedMs", recordedMs + (active && recorder != null ? elapsedCurrentMs() : 0))
            .putString("mimeType", "audio/mp4")
            .putInt("segmentSeconds", segmentSeconds)
            .putLong("warnBytes", warnBytes)
            .putLong("stopBytes", stopBytes);
        if (error == null) editor.remove("error"); else editor.putString("error", error);
        editor.apply();
    }

    public static JSObject readStatus(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("active", prefs.getBoolean("active", false));
        String meetingId = prefs.getString("meetingId", null);
        if (meetingId != null) result.put("meetingId", meetingId);
        result.put("segmentIds", parseArray(prefs.getString("segmentIds", "")));
        result.put("failedSegments", parseArray(prefs.getString("failedSegments", "")));
        result.put("totalBytes", prefs.getLong("totalBytes", 0));
        result.put("recordedMs", prefs.getLong("recordedMs", 0));
        result.put("mimeType", prefs.getString("mimeType", "audio/mp4"));
        String error = prefs.getString("error", null);
        if (error != null) result.put("error", error);
        return result;
    }

    public static JSObject statusFromIntent(Intent intent) {
        JSObject result = new JSObject();
        result.put("active", intent.getBooleanExtra("active", false));
        String meetingId = intent.getStringExtra("meetingId");
        if (meetingId != null) result.put("meetingId", meetingId);
        result.put("segmentIds", jsArray(intent.getIntArrayExtra("segmentIds")));
        result.put("failedSegments", jsArray(intent.getIntArrayExtra("failedSegments")));
        result.put("totalBytes", intent.getLongExtra("totalBytes", 0));
        result.put("recordedMs", intent.getLongExtra("recordedMs", 0));
        result.put("mimeType", intent.getStringExtra("mimeType"));
        if (intent.hasExtra("error")) result.put("error", intent.getStringExtra("error"));
        if (intent.hasExtra("reason")) result.put("reason", intent.getStringExtra("reason"));
        if (intent.hasExtra("seg")) result.put("seg", intent.getIntExtra("seg", 0));
        if (intent.hasExtra("bytes")) result.put("bytes", intent.getLongExtra("bytes", 0));
        if (intent.hasExtra("ms")) result.put("ms", intent.getLongExtra("ms", 0));
        if (intent.hasExtra("freeBytes")) result.put("freeBytes", intent.getLongExtra("freeBytes", 0));
        if (intent.hasExtra("memoryPressureLevel")) result.put("memoryPressureLevel", intent.getIntExtra("memoryPressureLevel", 0));
        return result;
    }

    private static int[] toIntArray(ArrayList<Integer> values) {
        int[] result = new int[values.size()];
        for (int i = 0; i < values.size(); i++) result[i] = values.get(i);
        return result;
    }

    private static JSArray jsArray(int[] values) {
        JSArray result = new JSArray();
        if (values != null) for (int value : values) result.put(value);
        return result;
    }

    private static String join(ArrayList<Integer> values) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) out.append(',');
            out.append(values.get(i));
        }
        return out.toString();
    }

    private static JSArray parseArray(String value) {
        JSArray result = new JSArray();
        if (value == null || value.isEmpty()) return result;
        for (String part : value.split(",")) {
            try { result.put(Integer.parseInt(part)); }
            catch (NumberFormatException ignored) { }
        }
        return result;
    }

    @Override
    public void onDestroy() {
        if (active) stopSession("Android stopped the recording service; completed segments are safe.", true);
        else releaseResources();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Active recordings", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shows while MeetingGhost is recording audio");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification(String detail) {
        Intent openIntent = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openIntent, pendingFlags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("MeetingGhost is recording")
            .setContentText(detail)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }
}
