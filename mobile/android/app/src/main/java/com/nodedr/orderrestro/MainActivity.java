package com.nodedr.orderrestro;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import org.json.JSONException;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ServerLinkPlugin.class);
        String server = ServerLinkPlugin.resolve(this);
        if (server != null && !server.isEmpty()) {
            // Open the restaurant's own server. The native bridge is injected for
            // that address, so push, haptics and location work inside its pages.
            JSONObject plugins = new JSONObject();
            try {
                plugins.put(
                    "PushNotifications",
                    new JSONObject().put("presentationOptions", new org.json.JSONArray().put("badge").put("sound").put("alert"))
                );
                plugins.put("SplashScreen", new JSONObject().put("launchShowDuration", 400).put("backgroundColor", "#9f1239"));
            } catch (JSONException ignored) {}
            this.config = new CapConfig.Builder(this)
                .setServerUrl(server)
                .setAllowNavigation(new String[] { "*" })
                .setAndroidScheme("https")
                .setAllowMixedContent(true)
                .setErrorPath("offline.html")
                .setPluginsConfiguration(plugins)
                .create();
        }
        super.onCreate(savedInstanceState);
        // Android 15 draws apps edge to edge. Keep the web view clear of the status bar,
        // the gesture bar and the keyboard.
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime()
            );
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        watchNetwork();
        // The error page is served locally, where the Capacitor bridge is not
        // injected, so it gets this tiny interface to retry or change server.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new Object() {
                @android.webkit.JavascriptInterface
                public String serverUrl() {
                    String u = ServerLinkPlugin.saved(MainActivity.this);
                    return u == null ? "" : u;
                }

                @android.webkit.JavascriptInterface
                public void forgetServer() {
                    ServerLinkPlugin.forgetAll(MainActivity.this);
                    runOnUiThread(MainActivity.this::recreate);
                }

                @android.webkit.JavascriptInterface
                public void retry() {
                    // Pick the local or online address again, then reopen.
                    runOnUiThread(MainActivity.this::recreate);
                }
            }, "OrderRestroNative");
        }
    }

    private android.net.ConnectivityManager.NetworkCallback networkCallback;

    /**
     * With both a local and an online address saved, move to the better one when
     * the phone changes network (walks into the restaurant WiFi, or leaves it).
     */
    private void watchNetwork() {
        if (ServerLinkPlugin.local(this).isEmpty() || ServerLinkPlugin.external(this).isEmpty()) return;
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            networkCallback = new android.net.ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(android.net.Network network) {
                    new Thread(() -> {
                        String now = ServerLinkPlugin.saved(MainActivity.this);
                        String next = ServerLinkPlugin.resolve(MainActivity.this);
                        if (!next.isEmpty() && !next.equals(now)) runOnUiThread(MainActivity.this::recreate);
                    }).start();
                }
            };
            cm.registerDefaultNetworkCallback(networkCallback);
        } catch (Throwable ignored) {}
    }

    @Override
    public void onDestroy() {
        if (networkCallback != null) {
            try {
                ((android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(networkCallback);
            } catch (Throwable ignored) {}
        }
        super.onDestroy();
    }
}
