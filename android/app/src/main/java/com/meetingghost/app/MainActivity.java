package com.meetingghost.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(FreeDiskPlugin.class);
        registerPlugin(RecordingSessionPlugin.class);
        registerPlugin(NativeAudioDecoderPlugin.class);
        registerPlugin(NativeAudioImportPlugin.class);
        registerPlugin(NativeSTTPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
