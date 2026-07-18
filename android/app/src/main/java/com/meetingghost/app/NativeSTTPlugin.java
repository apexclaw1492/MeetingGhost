package com.meetingghost.app;

import android.annotation.TargetApi;
import android.content.Intent;
import android.media.AudioFormat;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Android 13+ on-device saved-audio transcription.
 *
 * The exact one-minute range is decoded natively to mono 16 kHz PCM16, then
 * supplied through a pipe to the system's on-device SpeechRecognizer. The
 * recognizer is allowed to start only after checkRecognitionSupport accepts the
 * exact EXTRA_AUDIO_SOURCE intent; otherwise Android may silently open the
 * microphone, which is unacceptable for saved-recording transcription.
 */
@CapacitorPlugin(name = "NativeSTT")
public class NativeSTTPlugin extends Plugin {
    private static final long OPERATION_TIMEOUT_MS = 180_000;
    private static final String ENGINE = "android-on-device-speech";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicReference<Operation> active = new AtomicReference<>();

    @PluginMethod
    public void available(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolveUnavailable(call, "Android 13 or newer is required for verified saved-audio input.");
            return;
        }
        mainHandler.post(() -> probeSupport(call));
    }

    @PluginMethod
    public void info(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Audio path is required.");
            return;
        }
        executor.execute(() -> {
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                File file = NativeAudioDecoderPlugin.validatedPrivateFile(getContext(), path);
                retriever.setDataSource(file.getAbsolutePath());
                String rawDuration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                long durationMs = rawDuration == null ? 0 : Long.parseLong(rawDuration);
                if (durationMs <= 0) throw new IllegalStateException("Audio duration could not be determined.");
                JSObject result = new JSObject();
                result.put("durationMs", durationMs);
                result.put("bytes", file.length());
                result.put("engine", ENGINE);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Native audio inspection failed: " + safeMessage(error));
            } finally {
                try { retriever.release(); } catch (Exception ignored) { }
            }
        });
    }

    @PluginMethod
    public void transcribeFile(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || !SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) {
            call.reject("Verified on-device Android speech recognition is unavailable.", "ENGINE_UNAVAILABLE");
            return;
        }
        String path = call.getString("path");
        long startMs = Math.max(0, Math.round(valueOr(call.getDouble("startMs"), 0)));
        long durationMs = Math.round(valueOr(call.getDouble("durationMs"), NativeAudioDecoderPlugin.MAX_CHUNK_MS));
        if (path == null || path.isEmpty()) {
            call.reject("Audio path is required.");
            return;
        }
        if (durationMs <= 0 || durationMs > NativeAudioDecoderPlugin.MAX_CHUNK_MS) {
            call.reject("Native transcription chunks must be between 1 and 60000 milliseconds.");
            return;
        }

        Operation operation = new Operation(call, startMs, durationMs);
        if (!active.compareAndSet(null, operation)) {
            call.reject("Another native transcription operation is still active.", "ENGINE_BUSY");
            return;
        }
        operation.timeout = () -> finishError(
            operation,
            "Native Android transcription exceeded its three-minute deadline. Retry resumes from the last completed audio checkpoint.",
            "TRANSCRIPTION_TIMEOUT"
        );
        mainHandler.postDelayed(operation.timeout, OPERATION_TIMEOUT_MS);

        operation.decodeFuture = executor.submit(() -> {
            try {
                File file = NativeAudioDecoderPlugin.validatedPrivateFile(getContext(), path);
                NativeAudioDecoderPlugin.DecodeResult decoded = NativeAudioDecoderPlugin.decode(file, startMs, durationMs);
                if (operation.finished.get()) return;
                mainHandler.post(() -> beginRecognition(operation, decoded.pcm16));
            } catch (Exception error) {
                if (!operation.finished.get()) {
                    mainHandler.post(() -> finishError(
                        operation,
                        "Native Android audio preparation failed: " + safeMessage(error),
                        "AUDIO_PREPARATION_FAILED"
                    ));
                }
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        mainHandler.post(() -> {
            Operation operation = active.get();
            boolean canceled = operation != null;
            if (operation != null) {
                finishError(
                    operation,
                    "Native transcription canceled; saved audio and completed checkpoints are unchanged.",
                    "TRANSCRIPTION_CANCELED"
                );
            }
            JSObject result = new JSObject();
            result.put("canceled", canceled);
            call.resolve(result);
        });
    }

    @TargetApi(Build.VERSION_CODES.TIRAMISU)
    private void probeSupport(PluginCall call) {
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) {
            resolveUnavailable(call, "This device has no on-device speech recognition service.");
            return;
        }
        SpeechRecognizer recognizer = null;
        ParcelFileDescriptor[] pipe = null;
        try {
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
            pipe = ParcelFileDescriptor.createPipe();
            Intent intent = recognitionIntent(pipe[0]);
            SpeechRecognizer finalRecognizer = recognizer;
            ParcelFileDescriptor[] finalPipe = pipe;
            AtomicBoolean probeFinished = new AtomicBoolean(false);
            Runnable probeTimeout = () -> {
                if (!probeFinished.compareAndSet(false, true)) return;
                resolveUnavailable(call, "The on-device speech capability check exceeded four seconds.");
                closeQuietly(finalPipe[0]);
                closeQuietly(finalPipe[1]);
                finalRecognizer.destroy();
            };
            mainHandler.postDelayed(probeTimeout, 4_000);
            recognizer.checkRecognitionSupport(intent, getContext().getMainExecutor(), new RecognitionSupportCallback() {
                @Override
                public void onSupportResult(RecognitionSupport support) {
                    if (!probeFinished.compareAndSet(false, true)) return;
                    mainHandler.removeCallbacks(probeTimeout);
                    boolean englishReady = hasInstalledEnglish(support.getInstalledOnDeviceLanguages());
                    JSObject result = new JSObject();
                    result.put("available", englishReady);
                    result.put("engine", ENGINE);
                    result.put("maxChunkMs", NativeAudioDecoderPlugin.MAX_CHUNK_MS);
                    if (!englishReady) {
                        result.put("reason", "The on-device English speech model is not installed.");
                        result.put("modelDownloadAvailable", hasEnglish(
                            support.getPendingOnDeviceLanguages(), support.getSupportedOnDeviceLanguages()
                        ));
                    }
                    call.resolve(result);
                    closeQuietly(finalPipe[0]);
                    closeQuietly(finalPipe[1]);
                    finalRecognizer.destroy();
                }

                @Override
                public void onError(int error) {
                    if (!probeFinished.compareAndSet(false, true)) return;
                    mainHandler.removeCallbacks(probeTimeout);
                    resolveUnavailable(call, "The on-device recognizer rejected verified file-audio support (" + error + ").");
                    closeQuietly(finalPipe[0]);
                    closeQuietly(finalPipe[1]);
                    finalRecognizer.destroy();
                }
            });
        } catch (Exception error) {
            if (pipe != null) {
                closeQuietly(pipe[0]);
                closeQuietly(pipe[1]);
            }
            if (recognizer != null) recognizer.destroy();
            resolveUnavailable(call, "Native speech support check failed: " + safeMessage(error));
        }
    }

    @TargetApi(Build.VERSION_CODES.TIRAMISU)
    private void beginRecognition(Operation operation, byte[] pcm16) {
        if (operation.finished.get() || active.get() != operation) return;
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) {
            finishError(operation, "The on-device speech service became unavailable.", "ENGINE_UNAVAILABLE");
            return;
        }
        try {
            operation.pipe = ParcelFileDescriptor.createPipe();
            operation.recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
            operation.recognizer.setRecognitionListener(new OperationListener(operation));
            Intent intent = recognitionIntent(operation.pipe[0]);

            // Re-check this exact intent for every operation. Without proven
            // EXTRA_AUDIO_SOURCE support Android is documented to open the mic.
            operation.recognizer.checkRecognitionSupport(
                intent,
                getContext().getMainExecutor(),
                new RecognitionSupportCallback() {
                    @Override
                    public void onSupportResult(RecognitionSupport support) {
                        if (operation.finished.get() || active.get() != operation) return;
                        if (!hasInstalledEnglish(support.getInstalledOnDeviceLanguages())) {
                            finishError(operation, "The on-device English speech model is not installed.", "MODEL_UNAVAILABLE");
                            return;
                        }
                        try {
                            operation.recognizer.startListening(intent);
                            operation.writerFuture = executor.submit(() -> writeAudio(operation, pcm16));
                        } catch (Exception error) {
                            finishError(operation, "Native speech recognition could not start: " + safeMessage(error), "ENGINE_START_FAILED");
                        }
                    }

                    @Override
                    public void onError(int error) {
                        finishError(
                            operation,
                            "The on-device recognizer does not support verified saved-audio input (" + error + ").",
                            "AUDIO_SOURCE_UNSUPPORTED"
                        );
                    }
                }
            );
        } catch (Exception error) {
            finishError(operation, "Native speech recognition setup failed: " + safeMessage(error), "ENGINE_START_FAILED");
        }
    }

    @TargetApi(Build.VERSION_CODES.TIRAMISU)
    private Intent recognitionIntent(ParcelFileDescriptor audioSource) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag());
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, audioSource);
        intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
        intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
        intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, NativeAudioDecoderPlugin.TARGET_SAMPLE_RATE);
        intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
        return intent;
    }

    private void writeAudio(Operation operation, byte[] pcm16) {
        ParcelFileDescriptor writeSide = operation.pipe == null ? null : operation.pipe[1];
        if (writeSide == null) return;
        try (OutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(writeSide)) {
            int offset = 0;
            while (offset < pcm16.length && !operation.finished.get()) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException("Native speech audio feed canceled.");
                int count = Math.min(64 * 1024, pcm16.length - offset);
                output.write(pcm16, offset, count);
                offset += count;
            }
            output.flush();
        } catch (Exception error) {
            if (!operation.finished.get()) {
                mainHandler.post(() -> finishError(
                    operation,
                    "Native speech audio feed failed: " + safeMessage(error),
                    "AUDIO_FEED_FAILED"
                ));
            }
        }
    }

    private final class OperationListener implements RecognitionListener {
        private final Operation operation;
        OperationListener(Operation operation) { this.operation = operation; }

        @Override public void onReadyForSpeech(Bundle params) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onPartialResults(Bundle partialResults) { }
        @Override public void onEvent(int eventType, Bundle params) { }

        @Override
        public void onResults(Bundle results) {
            if (operation.segments.isEmpty()) addTopResult(operation, results);
            finishSuccess(operation);
        }

        @Override
        public void onSegmentResults(Bundle segmentResults) {
            addTopResult(operation, segmentResults);
        }

        @Override
        public void onEndOfSegmentedSession() {
            finishSuccess(operation);
        }

        @Override
        public void onError(int error) {
            if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                finishSuccess(operation); // explicit no-speech result is valid
                return;
            }
            finishError(operation, speechError(error), "RECOGNITION_FAILED");
        }
    }

    private void addTopResult(Operation operation, Bundle bundle) {
        ArrayList<String> results = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (results == null || results.isEmpty()) return;
        String text = results.get(0) == null ? "" : results.get(0).trim();
        if (!text.isEmpty()) operation.segments.add(text);
    }

    private void finishSuccess(Operation operation) {
        if (!operation.finished.compareAndSet(false, true)) return;
        cleanup(operation, false);
        JSObject result = new JSObject();
        result.put("text", String.join(" ", operation.segments).replaceAll("\\s+", " ").trim());
        result.put("engine", ENGINE);
        result.put("startMs", operation.startMs);
        result.put("durationMs", operation.durationMs);
        operation.call.resolve(result);
    }

    private void finishError(Operation operation, String message, String code) {
        if (!operation.finished.compareAndSet(false, true)) return;
        cleanup(operation, true);
        operation.call.reject(message, code);
    }

    private void cleanup(Operation operation, boolean cancelRecognizer) {
        mainHandler.removeCallbacks(operation.timeout);
        if (operation.decodeFuture != null) operation.decodeFuture.cancel(true);
        if (operation.writerFuture != null) operation.writerFuture.cancel(true);
        if (operation.recognizer != null) {
            if (cancelRecognizer) {
                try { operation.recognizer.cancel(); } catch (Exception ignored) { }
            }
            try { operation.recognizer.destroy(); } catch (Exception ignored) { }
        }
        if (operation.pipe != null) {
            closeQuietly(operation.pipe[0]);
            closeQuietly(operation.pipe[1]);
        }
        active.compareAndSet(operation, null);
    }

    private void resolveUnavailable(PluginCall call, String reason) {
        JSObject result = new JSObject();
        result.put("available", false);
        result.put("engine", ENGINE);
        result.put("reason", reason);
        result.put("maxChunkMs", NativeAudioDecoderPlugin.MAX_CHUNK_MS);
        call.resolve(result);
    }

    private static boolean hasInstalledEnglish(List<String> languages) {
        if (languages == null || languages.isEmpty()) return false;
        for (String language : languages) {
            if (language != null && language.toLowerCase(Locale.US).startsWith("en")) return true;
        }
        return false;
    }

    @SafeVarargs
    private static boolean hasEnglish(List<String>... groups) {
        for (List<String> group : groups) if (hasInstalledEnglish(group)) return true;
        return false;
    }

    private static String speechError(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "The on-device recognizer rejected the decoded audio.";
            case SpeechRecognizer.ERROR_CLIENT: return "The native recognition request was interrupted.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Android speech recognition permission is unavailable.";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED: return "The on-device recognizer does not support English.";
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE: return "The on-device English model is unavailable.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "The on-device recognizer is busy; Retry will resume this checkpoint.";
            case SpeechRecognizer.ERROR_SERVER_DISCONNECTED: return "The on-device recognition service disconnected.";
            case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS: return "The on-device recognizer temporarily refused another request.";
            default: return "On-device Android recognition failed with code " + error + ".";
        }
    }

    private static double valueOr(Double value, double fallback) {
        return value == null || !Double.isFinite(value) ? fallback : value;
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }

    private static void closeQuietly(ParcelFileDescriptor descriptor) {
        if (descriptor == null) return;
        try { descriptor.close(); } catch (Exception ignored) { }
    }

    private static final class Operation {
        final PluginCall call;
        final long startMs;
        final long durationMs;
        final AtomicBoolean finished = new AtomicBoolean(false);
        final ArrayList<String> segments = new ArrayList<>();
        Runnable timeout;
        Future<?> decodeFuture;
        Future<?> writerFuture;
        SpeechRecognizer recognizer;
        ParcelFileDescriptor[] pipe;

        Operation(PluginCall call, long startMs, long durationMs) {
            this.call = call;
            this.startMs = startMs;
            this.durationMs = durationMs;
        }
    }

    @Override
    protected void handleOnDestroy() {
        Operation operation = active.get();
        if (operation != null) {
            mainHandler.post(() -> finishError(
                operation,
                "Native transcription stopped because the Android activity closed.",
                "ENGINE_DESTROYED"
            ));
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
