package com.codeenzyme.glimmerdeep;

import android.speech.tts.TextToSpeech;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * Board talk's voice (SPEC section 28): the phone's text-to-speech engine. Glue only: what to say is decided in
 * JavaScript (src/ui/talk.js). speak cuts off whatever was being said; an empty text just stops. A phone with no
 * engine, or one that fails to start, answers spoken: false and stays quiet.
 */
@CapacitorPlugin(name = "Speech")
public class SpeechPlugin extends Plugin {
    private TextToSpeech tts;
    private volatile boolean ready;

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), status -> {
            if (status != TextToSpeech.SUCCESS || tts == null) return;
            int lang = tts.setLanguage(Locale.getDefault());
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                lang = tts.setLanguage(Locale.US);
            }
            ready = lang != TextToSpeech.LANG_MISSING_DATA && lang != TextToSpeech.LANG_NOT_SUPPORTED;
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        JSObject ret = new JSObject();
        if (!ready || tts == null) {
            ret.put("spoken", false);
            call.resolve(ret);
            return;
        }
        if (text == null || text.isEmpty()) {
            tts.stop();
            ret.put("spoken", false);
        } else {
            ret.put("spoken", tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "board") == TextToSpeech.SUCCESS);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ready", ready);
        call.resolve(ret);
    }

    @Override
    protected void handleOnPause() {
        if (tts != null) tts.stop();   // no voice from a game in the background
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        ready = false;
    }
}
