package com.meetingghost.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Capacitor bridge for the foreground-service-owned native recorder. */
@CapacitorPlugin(
    name = "RecordingSession",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class RecordingSessionPlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private PluginCall pendingStart;
    private PluginCall pendingStop;
    private boolean receiverRegistered;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!RecordingSessionService.ACTION_EVENT.equals(intent.getAction())) return;
            String event = intent.getStringExtra(RecordingSessionService.EXTRA_EVENT);
            JSObject status = RecordingSessionService.statusFromIntent(intent);
            if ("started".equals(event) && pendingStart != null) {
                PluginCall call = pendingStart;
                pendingStart = null;
                call.resolve(status);
            } else if ("error".equals(event) && pendingStart != null) {
                PluginCall call = pendingStart;
                pendingStart = null;
                call.reject(status.optString("error", "Native recording could not start."));
            } else if ("stopped".equals(event) && pendingStop != null) {
                PluginCall call = pendingStop;
                pendingStop = null;
                call.resolve(status);
            }

            // Do not retain per-segment events while the WebView is suspended;
            // status() reconciles authoritative native state on foreground.
            if ("segmentSaved".equals(event)) notifyListeners("segmentSaved", status);
            else if ("storageWarning".equals(event)) notifyListeners("storageWarning", status);
            else if ("interrupted".equals(event)) notifyListeners("recordingInterrupted", status);
            else if ("segmentError".equals(event) || "error".equals(event)) notifyListeners("recordingError", status);
            else if ("autoStopped".equals(event)) notifyListeners("autoStopped", status);
            else if ("memoryPressure".equals(event)) notifyListeners("memoryPressure", status);
        }
    };

    @Override
    public void load() {
        ContextCompat.registerReceiver(
            getContext(),
            receiver,
            new IntentFilter(RecordingSessionService.ACTION_EVENT),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
        receiverRegistered = true;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        startAfterPermission(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startAfterPermission(call);
        else call.reject("Microphone permission denied. Enable it in Settings → MeetingGhost.");
    }

    private void startAfterPermission(PluginCall call) {
        if (pendingStart != null) {
            call.reject("A native recording start is already pending.");
            return;
        }
        String meetingId = call.getString("meetingId");
        if (meetingId == null || !meetingId.matches("[A-Za-z0-9_-]+")) {
            call.reject("A safe meetingId is required.");
            return;
        }
        pendingStart = call;
        Intent intent = new Intent(getContext(), RecordingSessionService.class)
            .setAction(RecordingSessionService.ACTION_START)
            .putExtra("meetingId", meetingId)
            .putExtra("segmentSeconds", call.getInt("segmentSeconds", 15))
            .putExtra("warnBytes", call.getLong("warnBytes", 500L * 1024 * 1024))
            .putExtra("stopBytes", call.getLong("stopBytes", 100L * 1024 * 1024));
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(getContext(), intent);
            else getContext().startService(intent);
        } catch (Exception error) {
            pendingStart = null;
            call.reject("Could not start the native recording service", error);
            return;
        }
        handler.postDelayed(() -> {
            if (pendingStart == call) {
                pendingStart = null;
                call.reject("Native recording did not confirm startup within 10 seconds.");
            }
        }, 10_000);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        JSObject status = RecordingSessionService.readStatus(getContext());
        if (!status.optBoolean("active", false)) {
            call.resolve(status);
            return;
        }
        if (pendingStop != null) {
            call.reject("A native recording stop is already pending.");
            return;
        }
        pendingStop = call;
        Intent intent = new Intent(getContext(), RecordingSessionService.class)
            .setAction(RecordingSessionService.ACTION_STOP);
        try {
            getContext().startService(intent);
        } catch (Exception error) {
            pendingStop = null;
            call.reject("Could not stop the native recording service", error);
            return;
        }
        handler.postDelayed(() -> {
            if (pendingStop == call) {
                pendingStop = null;
                JSObject latest = RecordingSessionService.readStatus(getContext());
                if (!latest.optBoolean("active", false)) call.resolve(latest);
                else call.reject("Native recording did not finalize within 15 seconds; reopen the app to recover completed segments.");
            }
        }, 15_000);
    }

    @PluginMethod
    public void flush(PluginCall call) {
        JSObject status = RecordingSessionService.readStatus(getContext());
        if (status.optBoolean("active", false)) {
            getContext().startService(new Intent(getContext(), RecordingSessionService.class)
                .setAction(RecordingSessionService.ACTION_FLUSH));
        }
        call.resolve(status);
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(RecordingSessionService.readStatus(getContext()));
    }

    @Override
    protected void handleOnDestroy() {
        if (receiverRegistered) {
            try { getContext().unregisterReceiver(receiver); }
            catch (IllegalArgumentException ignored) { }
            receiverRegistered = false;
        }
        // Do not stop the service here: Activity/WebView destruction must not
        // own microphone lifetime. Relaunch status recovery finalizes it.
        super.handleOnDestroy();
    }
}
