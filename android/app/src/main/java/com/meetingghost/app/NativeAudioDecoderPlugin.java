package com.meetingghost.app;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import android.os.SystemClock;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Bounded native audio decode for Android transcription. The WebView never
 * receives an encoded hours-long file or asks AudioContext to decode it all at
 * once. Each call emits at most 60 seconds of mono 16 kHz PCM16 from a file in
 * this app's private data directory.
 */
@CapacitorPlugin(name = "NativeAudioDecoder")
public class NativeAudioDecoderPlugin extends Plugin {
    static final int TARGET_SAMPLE_RATE = 16_000;
    static final long MAX_CHUNK_MS = 60_000;
    private static final long DECODE_TIMEOUT_MS = 120_000;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void available(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.N);
        result.put("engine", "android-mediacodec");
        result.put("maxChunkMs", MAX_CHUNK_MS);
        call.resolve(result);
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
                File file = validatedPrivateFile(getContext(), path);
                retriever.setDataSource(file.getAbsolutePath());
                String durationValue = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                long durationMs = durationValue == null ? 0 : Long.parseLong(durationValue);
                if (durationMs <= 0) throw new IllegalStateException("Audio duration could not be determined.");
                JSObject result = new JSObject();
                result.put("durationMs", durationMs);
                result.put("bytes", file.length());
                result.put("engine", "android-mediacodec");
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Native audio inspection failed: " + safeMessage(error));
            } finally {
                try { retriever.release(); } catch (Exception ignored) { }
            }
        });
    }

    @PluginMethod
    public void decodeChunk(PluginCall call) {
        String path = call.getString("path");
        long startMs = Math.max(0, Math.round(valueOr(call.getDouble("startMs"), 0)));
        long durationMs = Math.round(valueOr(call.getDouble("durationMs"), MAX_CHUNK_MS));
        if (path == null || path.isEmpty()) {
            call.reject("Audio path is required.");
            return;
        }
        if (durationMs <= 0 || durationMs > MAX_CHUNK_MS) {
            call.reject("Native decode chunks must be between 1 and 60000 milliseconds.");
            return;
        }

        executor.execute(() -> {
            try {
                File file = validatedPrivateFile(getContext(), path);
                DecodeResult decoded = decode(file, startMs, durationMs);
                JSObject result = new JSObject();
                result.put("pcm16Base64", Base64.encodeToString(decoded.pcm16, Base64.NO_WRAP));
                result.put("sampleRate", TARGET_SAMPLE_RATE);
                result.put("channels", 1);
                result.put("samples", decoded.pcm16.length / 2);
                result.put("durationMs", Math.round((decoded.pcm16.length / 2.0) * 1000.0 / TARGET_SAMPLE_RATE));
                result.put("startMs", startMs);
                result.put("engine", "android-mediacodec");
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Native audio decode failed: " + safeMessage(error));
            }
        });
    }

    static File validatedPrivateFile(Context context, String rawPath) throws Exception {
        File root = context.getFilesDir().getCanonicalFile();
        File file = new File(rawPath).getCanonicalFile();
        String rootPrefix = root.getPath() + File.separator;
        if (!file.getPath().startsWith(rootPrefix)) {
            throw new SecurityException("Audio file is outside the app-private data directory.");
        }
        if (!file.isFile() || file.length() <= 0) {
            throw new IllegalArgumentException("Audio file is missing or empty.");
        }
        return file;
    }

    static DecodeResult decode(File file, long startMs, long durationMs) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        try {
            extractor.setDataSource(file.getAbsolutePath());
            int trackIndex = -1;
            MediaFormat sourceFormat = null;
            for (int index = 0; index < extractor.getTrackCount(); index++) {
                MediaFormat candidate = extractor.getTrackFormat(index);
                String candidateMime = candidate.getString(MediaFormat.KEY_MIME);
                if (candidateMime != null && candidateMime.startsWith("audio/")) {
                    trackIndex = index;
                    sourceFormat = candidate;
                    break;
                }
            }
            if (trackIndex < 0 || sourceFormat == null) throw new IllegalArgumentException("No audio track was found.");
            String mime = sourceFormat.getString(MediaFormat.KEY_MIME);
            if (mime == null) throw new IllegalArgumentException("Audio track has no codec type.");

            extractor.selectTrack(trackIndex);
            long startUs = startMs * 1000L;
            long endUs = (startMs + durationMs) * 1000L;
            extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);

            // Request a predictable decoder output when the codec honors it.
            sourceFormat.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
            codec = MediaCodec.createDecoderByType(mime);
            codec.configure(sourceFormat, null, null, 0);
            codec.start();

            MediaCodec.BufferInfo bufferInfo = new MediaCodec.BufferInfo();
            ByteArrayOutputStream output = new ByteArrayOutputStream((int) Math.min(Integer.MAX_VALUE, TARGET_SAMPLE_RATE * durationMs / 500));
            boolean inputDone = false;
            boolean outputDone = false;
            int sampleRate = sourceFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)
                ? sourceFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 48_000;
            int channels = sourceFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
                ? sourceFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 1;
            int pcmEncoding = AudioFormat.ENCODING_PCM_16BIT;
            double nextOutputUs = startUs;
            long deadline = SystemClock.elapsedRealtime() + DECODE_TIMEOUT_MS;

            while (!outputDone) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException("Native audio decode canceled.");
                if (SystemClock.elapsedRealtime() > deadline) throw new IllegalStateException("Decoder exceeded its two-minute deadline.");
                if (!inputDone) {
                    int inputIndex = codec.dequeueInputBuffer(10_000);
                    if (inputIndex >= 0) {
                        ByteBuffer input = codec.getInputBuffer(inputIndex);
                        if (input == null) throw new IllegalStateException("Decoder input buffer was unavailable.");
                        long sampleTime = extractor.getSampleTime();
                        if (sampleTime < 0 || sampleTime >= endUs) {
                            codec.queueInputBuffer(inputIndex, 0, 0, Math.max(startUs, sampleTime), MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            input.clear();
                            int size = extractor.readSampleData(input, 0);
                            if (size < 0) {
                                codec.queueInputBuffer(inputIndex, 0, 0, Math.max(startUs, sampleTime), MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                inputDone = true;
                            } else {
                                codec.queueInputBuffer(inputIndex, 0, size, sampleTime, 0);
                                extractor.advance();
                            }
                        }
                    }
                }

                int outputIndex = codec.dequeueOutputBuffer(bufferInfo, 10_000);
                if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat decodedFormat = codec.getOutputFormat();
                    sampleRate = decodedFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    channels = decodedFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    pcmEncoding = decodedFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)
                        ? decodedFormat.getInteger(MediaFormat.KEY_PCM_ENCODING) : AudioFormat.ENCODING_PCM_16BIT;
                    if (pcmEncoding != AudioFormat.ENCODING_PCM_16BIT && pcmEncoding != AudioFormat.ENCODING_PCM_FLOAT) {
                        throw new IllegalStateException("Unsupported decoder PCM encoding " + pcmEncoding + ".");
                    }
                } else if (outputIndex >= 0) {
                    ByteBuffer buffer = codec.getOutputBuffer(outputIndex);
                    if (buffer != null && bufferInfo.size > 0) {
                        buffer.order(ByteOrder.nativeOrder());
                        buffer.position(bufferInfo.offset);
                        buffer.limit(bufferInfo.offset + bufferInfo.size);
                        int bytesPerSample = pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT ? 4 : 2;
                        int frameBytes = Math.max(1, channels) * bytesPerSample;
                        int frames = bufferInfo.size / frameBytes;
                        double sourceFrameUs = 1_000_000.0 / Math.max(1, sampleRate);
                        double targetFrameUs = 1_000_000.0 / TARGET_SAMPLE_RATE;
                        for (int frame = 0; frame < frames; frame++) {
                            double frameUs = bufferInfo.presentationTimeUs + frame * sourceFrameUs;
                            if (frameUs < startUs) continue;
                            if (frameUs >= endUs) {
                                outputDone = true;
                                break;
                            }
                            int frameOffset = bufferInfo.offset + frame * frameBytes;
                            float mono = 0f;
                            for (int channel = 0; channel < channels; channel++) {
                                int sampleOffset = frameOffset + channel * bytesPerSample;
                                mono += pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT
                                    ? buffer.getFloat(sampleOffset)
                                    : buffer.getShort(sampleOffset) / 32768f;
                            }
                            mono /= Math.max(1, channels);
                            while (nextOutputUs <= frameUs && nextOutputUs < endUs) {
                                short value = (short) Math.round(Math.max(-1f, Math.min(1f, mono)) * 32767f);
                                output.write(value & 0xff);
                                output.write((value >>> 8) & 0xff);
                                nextOutputUs += targetFrameUs;
                            }
                        }
                    }
                    if ((bufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                    codec.releaseOutputBuffer(outputIndex, false);
                }
            }

            byte[] pcm = output.toByteArray();
            if (pcm.length == 0) throw new IllegalStateException("Decoder produced no samples for this range.");
            return new DecodeResult(pcm);
        } finally {
            if (codec != null) {
                try { codec.stop(); } catch (Exception ignored) { }
                codec.release();
            }
            extractor.release();
        }
    }

    private static double valueOr(Double value, double fallback) {
        return value == null || !Double.isFinite(value) ? fallback : value;
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }

    static final class DecodeResult {
        final byte[] pcm16;
        DecodeResult(byte[] pcm16) { this.pcm16 = pcm16; }
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
