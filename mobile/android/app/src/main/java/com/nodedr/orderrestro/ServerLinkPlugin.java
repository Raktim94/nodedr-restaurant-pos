package com.nodedr.orderrestro;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Remembers which restaurant server this phone talks to. OrderRestro is
 * self-hosted, so the address is typed (or scanned) once and the app then opens
 * that server's own web app. The choice is applied the next time the screen is
 * created, which is why connect() and forget() recreate the activity.
 */
@CapacitorPlugin(name = "ServerLink")
public class ServerLinkPlugin extends Plugin {

    static final String PREFS = "orderrestro";
    static final String KEY_URL = "serverUrl";

    static String saved(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return p.getString(KEY_URL, null);
    }

    @PluginMethod
    public void current(PluginCall call) {
        JSObject r = new JSObject();
        String url = saved(getContext());
        r.put("url", url == null ? "" : url);
        r.put("version", com.nodedr.orderrestro.BuildConfig.VERSION_NAME);
        call.resolve(r);
    }

    /**
     * True only when this build has a Firebase config (google-services.json).
     * Asking the push plugin to register without one crashes the whole app, so
     * the web app checks here first.
     */
    @PluginMethod
    public void pushReady(PluginCall call) {
        boolean ready = false;
        try {
            Class<?> app = Class.forName("com.google.firebase.FirebaseApp");
            Object apps = app.getMethod("getApps", Context.class).invoke(null, getContext());
            ready = apps instanceof java.util.List && !((java.util.List<?>) apps).isEmpty();
        } catch (Throwable ignored) {
            ready = false;
        }
        JSObject r = new JSObject();
        r.put("ready", ready);
        call.resolve(r);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("Enter a full address such as http://192.168.1.20:1995");
            return;
        }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_URL, url).apply();
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void forget(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_URL).apply();
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }
}
