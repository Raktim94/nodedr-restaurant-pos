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
 * that server's own web app.
 *
 * Like Immich, a restaurant can save two addresses for the same server: a local
 * one (the computer on the restaurant WiFi, works with no internet) and an online
 * one (https address that works from anywhere). At launch, and whenever the
 * network changes, the app uses the local address if it answers and the online
 * address otherwise. The choice is applied the next time the screen is created,
 * which is why connect() and forget() recreate the activity.
 */
@CapacitorPlugin(name = "ServerLink")
public class ServerLinkPlugin extends Plugin {

    static final String PREFS = "orderrestro";
    static final String KEY_LOCAL = "localUrl";
    static final String KEY_EXTERNAL = "externalUrl";
    static final String KEY_ACTIVE = "serverUrl"; // the address in use right now (also the pre-1.16 single address)
    static final String KEY_LAST_LOCAL = "lastLocalUrl";
    static final String KEY_LAST_EXTERNAL = "lastExternalUrl";
    static final String KEY_MODE = "mode"; // "app" (the restaurant's web app) or "standalone" (the POS inside this app)

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Which half of the app opens at start: "app" or "standalone". */
    static String mode(Context ctx) {
        return prefs(ctx).getString(KEY_MODE, "app");
    }

    /** True for addresses that only work on the restaurant network. */
    static boolean isLocalAddress(String url) {
        try {
            java.net.URI u = java.net.URI.create(url);
            String h = u.getHost() == null ? "" : u.getHost().toLowerCase();
            return h.matches("(10|127)\\..*|192\\.168\\..*|172\\.(1[6-9]|2\\d|3[01])\\..*|169\\.254\\..*")
                || h.endsWith(".local") || h.endsWith(".lan") || (!h.isEmpty() && !h.contains("."));
        } catch (Exception e) {
            return false;
        }
    }

    private static String str(SharedPreferences p, String k) {
        String v = p.getString(k, null);
        return v == null ? "" : v;
    }

    /** Saved local address; an address saved by an older version is sorted into local or online. */
    static String local(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String v = str(p, KEY_LOCAL);
        if (v.isEmpty() && str(p, KEY_EXTERNAL).isEmpty() && isLocalAddress(str(p, KEY_ACTIVE))) return str(p, KEY_ACTIVE);
        return v;
    }

    static String external(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String v = str(p, KEY_EXTERNAL);
        String old = str(p, KEY_ACTIVE);
        if (v.isEmpty() && str(p, KEY_LOCAL).isEmpty() && !old.isEmpty() && !isLocalAddress(old)) return old;
        return v;
    }

    /** The address chosen last time (no network access). Empty when not connected. */
    static String saved(Context ctx) {
        String a = str(prefs(ctx), KEY_ACTIVE);
        if (!a.isEmpty()) return a;
        String l = local(ctx);
        return l.isEmpty() ? external(ctx) : l;
    }

    /** Does an OrderRestro server answer at this address within a moment? */
    static boolean reachable(String base) {
        java.net.HttpURLConnection c = null;
        try {
            c = (java.net.HttpURLConnection) new java.net.URL(base + "/api/v1/auth/setup-status").openConnection();
            c.setConnectTimeout(1500);
            c.setReadTimeout(1500);
            return c.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** True when the phone is only on mobile data, where a local address cannot answer. */
    private static boolean onlyMobileData(Context ctx) {
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            android.net.NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
            if (caps == null) return false;
            return caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR)
                && !caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)
                && !caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)
                && !caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN);
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * Which saved address to use now: local if it answers, else online. With one
     * saved address there is nothing to decide. Blocks for at most about 2 seconds,
     * so call it off the main thread or at start-up behind the splash screen.
     */
    static String resolve(Context ctx) {
        String l = local(ctx);
        String e = external(ctx);
        String pick;
        if (l.isEmpty() || e.isEmpty()) {
            pick = l.isEmpty() ? e : l;
        } else if (onlyMobileData(ctx)) {
            pick = e;
        } else {
            final boolean[] ok = { false };
            final String probe = l;
            Thread t = new Thread(() -> ok[0] = reachable(probe));
            t.start();
            try {
                t.join(2500);
            } catch (InterruptedException ignored) {}
            pick = ok[0] ? l : e;
        }
        if (!pick.isEmpty()) prefs(ctx).edit().putString(KEY_ACTIVE, pick).apply();
        return pick;
    }

    @PluginMethod
    public void current(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences p = prefs(ctx);
        JSObject r = new JSObject();
        String active = saved(ctx);
        r.put("url", active);
        String l = local(ctx);
        String e = external(ctx);
        // After "Change server" the old addresses stay behind so the form can offer them again.
        r.put("localUrl", l.isEmpty() && active.isEmpty() ? str(p, KEY_LAST_LOCAL) : l);
        r.put("externalUrl", e.isEmpty() && active.isEmpty() ? str(p, KEY_LAST_EXTERNAL) : e);
        r.put("mode", active.isEmpty() ? "" : active.equals(l) ? "local" : "online");
        r.put("version", com.nodedr.orderrestro.BuildConfig.VERSION_NAME);
        r.put("startMode", mode(ctx));
        call.resolve(r);
    }

    /** Open the app as the restaurant's web app ("app") or as the standalone POS ("standalone"). */
    @PluginMethod
    public void setMode(PluginCall call) {
        String m = call.getString("mode", "app");
        if (!"app".equals(m) && !"standalone".equals(m)) {
            call.reject("Unknown mode");
            return;
        }
        prefs(getContext()).edit().putString(KEY_MODE, m).apply();
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
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

    private static boolean validUrl(String u) {
        return u != null && (u.startsWith("http://") || u.startsWith("https://"));
    }

    /** Save the addresses: {localUrl?, externalUrl?} (a single {url} from older callers also works). */
    @PluginMethod
    public void connect(PluginCall call) {
        String l = call.getString("localUrl", "");
        String e = call.getString("externalUrl", "");
        String one = call.getString("url", "");
        if (l.isEmpty() && e.isEmpty() && !one.isEmpty()) {
            if (isLocalAddress(one)) l = one;
            else e = one;
        }
        if ((l.isEmpty() && e.isEmpty()) || (!l.isEmpty() && !validUrl(l)) || (!e.isEmpty() && !validUrl(e))) {
            call.reject("Enter a full address such as http://192.168.1.20:1995");
            return;
        }
        prefs(getContext()).edit()
            .putString(KEY_LOCAL, l)
            .putString(KEY_EXTERNAL, e)
            .putString(KEY_ACTIVE, l.isEmpty() ? e : l) // resolve() refines this when the screen is created
            .apply();
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void forget(PluginCall call) {
        forgetAll(getContext());
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    static void forgetAll(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String l = local(ctx);
        String e = external(ctx);
        p.edit()
            .putString(KEY_LAST_LOCAL, l)
            .putString(KEY_LAST_EXTERNAL, e)
            .remove(KEY_LOCAL)
            .remove(KEY_EXTERNAL)
            .remove(KEY_ACTIVE)
            .apply();
    }
}
