package com.meetingghost.app;

import android.os.StatFs;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Reports real app-volume free space for recorder warning and safe auto-stop. */
@CapacitorPlugin(name = "FreeDisk")
public class FreeDiskPlugin extends Plugin {
    @PluginMethod
    public void free(PluginCall call) {
        try {
            StatFs stats = new StatFs(getContext().getFilesDir().getAbsolutePath());
            JSObject result = new JSObject();
            result.put("free", stats.getAvailableBytes());
            result.put("total", stats.getTotalBytes());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Free-disk query failed", error);
        }
    }
}
