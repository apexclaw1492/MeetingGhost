package com.meetingghost.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Streams a picked audio document directly into verified app-private storage. */
@CapacitorPlugin(name = "NativeAudioImport")
public class NativeAudioImportPlugin extends Plugin {
    private static final long COPY_TIMEOUT_MS = 10 * 60 * 1000L;
    private static final long STOP_FREE_BYTES = 100L * 1024 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean presenting = new AtomicBoolean(false);

    @PluginMethod
    public void pick(PluginCall call) {
        String meetingId = call.getString("meetingId");
        if (meetingId == null || !meetingId.matches("^[A-Za-z0-9_-]+$")) {
            call.reject("A valid meeting ID is required.");
            return;
        }
        if (!presenting.compareAndSet(false, true)) {
            call.reject("Another audio import is already open.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("audio/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickedAudio");
    }

    @ActivityCallback
    private void pickedAudio(PluginCall call, ActivityResult result) {
        presenting.set(false);
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Audio import canceled.", "IMPORT_CANCELED");
            return;
        }
        Uri uri = result.getData().getData();
        String meetingId = call.getString("meetingId");
        if (meetingId == null) {
            call.reject("The import meeting ID was lost.");
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) { }

        File directory = new File(getContext().getFilesDir(), "recordings/" + meetingId);
        File partial = new File(directory, "seg-0.partial.import");
        File completed = new File(directory, "seg-0");
        AtomicBoolean finished = new AtomicBoolean(false);
        Runnable timeout = () -> {
            if (finished.compareAndSet(false, true)) {
                partial.delete();
                call.reject("Saving imported audio exceeded ten minutes. No incomplete file was published; choose the file again after checking storage.");
            }
        };
        mainHandler.postDelayed(timeout, COPY_TIMEOUT_MS);
        emitProgress(meetingId, "copying", 0);

        executor.execute(() -> {
            try {
                if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Could not create the recording directory.");
                if (completed.exists()) throw new IllegalStateException("This meeting already has imported audio.");
                partial.delete();
                ContentResolver resolver = getContext().getContentResolver();
                long copied = 0;
                long nextStorageCheck = 0;
                long nextProgress = 8L * 1024 * 1024;
                try (InputStream input = resolver.openInputStream(uri); FileOutputStream output = new FileOutputStream(partial)) {
                    if (input == null) throw new IllegalStateException("The selected document could not be opened.");
                    byte[] buffer = new byte[64 * 1024];
                    while (!finished.get()) {
                        int count = input.read(buffer);
                        if (count < 0) break;
                        if (count == 0) continue;
                        output.write(buffer, 0, count);
                        copied += count;
                        if (copied >= nextProgress) {
                            emitProgress(meetingId, "copying", copied);
                            nextProgress = copied + 8L * 1024 * 1024;
                        }
                        if (copied >= nextStorageCheck) {
                            if (new StatFs(directory.getAbsolutePath()).getAvailableBytes() < STOP_FREE_BYTES) {
                                throw new IllegalStateException("Storage fell below 100 MB while copying the import.");
                            }
                            nextStorageCheck = copied + 4L * 1024 * 1024;
                        }
                    }
                    if (finished.get()) return;
                    output.flush();
                    output.getFD().sync();
                }
                emitProgress(meetingId, "finalizing", copied);
                if (copied <= 0 || partial.length() != copied) throw new IllegalStateException("Imported audio byte verification failed.");
                if (!partial.renameTo(completed)) throw new IllegalStateException("Imported audio could not be atomically finalized.");
                if (!completed.isFile() || completed.length() != copied) {
                    completed.delete();
                    throw new IllegalStateException("Final imported audio verification failed.");
                }
                if (finished.compareAndSet(false, true)) {
                    mainHandler.removeCallbacks(timeout);
                    JSObject response = new JSObject();
                    response.put("bytes", copied);
                    response.put("mimeType", valueOr(resolver.getType(uri), "audio/*"));
                    response.put("displayName", displayName(resolver, uri));
                    response.put("segmentId", 0);
                    call.resolve(response);
                }
            } catch (Exception error) {
                partial.delete();
                if (finished.compareAndSet(false, true)) {
                    mainHandler.removeCallbacks(timeout);
                    call.reject("Could not save imported audio: " + safeMessage(error));
                }
            }
        });
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) return valueOr(cursor.getString(column), "Imported Meeting");
            }
        } catch (Exception ignored) { }
        return "Imported Meeting";
    }

    private void emitProgress(String meetingId, String phase, long bytes) {
        JSObject event = new JSObject();
        event.put("meetingId", meetingId);
        event.put("phase", phase);
        event.put("bytes", bytes);
        notifyListeners("progress", event);
    }

    private static String valueOr(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
