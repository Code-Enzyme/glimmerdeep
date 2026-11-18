package com.codeenzyme.glimmerdeep;

import android.util.AtomicFile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * The second copy of the save (SPEC section 16). The WebView writes localStorage to disk a few seconds after a
 * change, so an app killed right after a save could come back without it. Every save is also written here, to
 * save.json in the app's own storage: atomically (AtomicFile keeps the old file until the new one is complete)
 * and synced to disk before the call answers. Glue only: which copy wins is decided in src/ui/store.js.
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {
    private AtomicFile file() {
        return new AtomicFile(new File(getContext().getFilesDir(), "save.json"));
    }

    @PluginMethod
    public synchronized void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("no data");
            return;
        }
        AtomicFile file = file();
        FileOutputStream out = null;
        try {
            out = file.startWrite();
            out.write(data.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(out);   // flushes, syncs and renames into place
            call.resolve();
        } catch (IOException e) {
            if (out != null) file.failWrite(out);
            call.reject("could not write the save", e);
        }
    }

    @PluginMethod
    public synchronized void read(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("data", new String(file().readFully(), StandardCharsets.UTF_8));
        } catch (FileNotFoundException e) {
            // no copy yet: answer without data
        } catch (IOException e) {
            call.reject("could not read the save", e);
            return;
        }
        call.resolve(ret);
    }
}
