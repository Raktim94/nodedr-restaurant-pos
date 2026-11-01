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
        String server = ServerLinkPlugin.saved(this);
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
                    getSharedPreferences(ServerLinkPlugin.PREFS, MODE_PRIVATE).edit().remove(ServerLinkPlugin.KEY_URL).apply();
                    runOnUiThread(MainActivity.this::recreate);
                }
            }, "OrderRestroNative");
        }
    }
}
