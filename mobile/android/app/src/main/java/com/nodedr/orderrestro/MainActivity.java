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
        registerPlugin(NativePrinterPlugin.class);
        // In standalone mode the POS bundled in the app opens instead of the
        // restaurant's web app, so it starts with no server at all.
        boolean standalone = "standalone".equals(ServerLinkPlugin.mode(this));
        String server = standalone ? null : ServerLinkPlugin.resolve(this);
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
        quietErrors();
        handleDownloads();
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
                public void openStandalone() {
                    getSharedPreferences(ServerLinkPlugin.PREFS, MODE_PRIVATE).edit().putString(ServerLinkPlugin.KEY_MODE, "standalone").apply();
                    runOnUiThread(MainActivity.this::recreate);
                }

                /**
                 * Opens a payment page (or any https link) in the phone's own browser so the
                 * customer pays outside the app and the app keeps its place. https only.
                 */
                @android.webkit.JavascriptInterface
                public void openExternal(String url) {
                    if (url == null || !url.startsWith("https://")) return;
                    runOnUiThread(() -> {
                        try {
                            startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)));
                        } catch (Throwable ignored) {}
                    });
                }

                /**
                 * Saves a file the web app made on the phone (a CSV or report). A WebView cannot
                 * download blob: links by itself, so the page sends the bytes as base64 and we
                 * put the file in the phone's Downloads folder.
                 */
                @android.webkit.JavascriptInterface
                public boolean saveFile(String name, String mime, String base64) {
                    return saveToDownloads(name, mime, android.util.Base64.decode(base64, android.util.Base64.DEFAULT));
                }

                @android.webkit.JavascriptInterface
                public void retry() {
                    // Pick the local or online address again, then reopen.
                    runOnUiThread(MainActivity.this::recreate);
                }
            }, "OrderRestroNative");
        }
    }

    /** Writes bytes to Downloads (MediaStore on Android 10+, the public folder before). Returns true on success. */
    private boolean saveToDownloads(String rawName, String mime, byte[] bytes) {
        try {
            String name = rawName == null ? "download" : rawName.replaceAll("[\\\\/:*?\"<>|]", "_");
            if (name.isEmpty()) name = "download";
            String type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
            java.io.OutputStream out;
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                android.content.ContentValues v = new android.content.ContentValues();
                v.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(android.provider.MediaStore.Downloads.MIME_TYPE, type);
                v.put(android.provider.MediaStore.Downloads.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS);
                android.net.Uri uri = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return false;
                out = getContentResolver().openOutputStream(uri);
            } else {
                java.io.File dir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) return false;
                out = new java.io.FileOutputStream(new java.io.File(dir, name));
            }
            if (out == null) return false;
            try { out.write(bytes); } finally { out.close(); }
            final String shown = name;
            runOnUiThread(() -> android.widget.Toast.makeText(this, "Saved to Downloads: " + shown, android.widget.Toast.LENGTH_LONG).show());
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Normal https download links (a file the server sends): hand them to the phone's download manager with the sign-in cookie. */
    private void handleDownloads() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;
                android.app.DownloadManager.Request r = new android.app.DownloadManager.Request(android.net.Uri.parse(url));
                String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
                if (cookie != null) r.addRequestHeader("Cookie", cookie);
                if (userAgent != null) r.addRequestHeader("User-Agent", userAgent);
                String name = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType);
                r.setMimeType(mimeType);
                r.setTitle(name);
                r.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, name);
                ((android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
                android.widget.Toast.makeText(this, "Downloading " + name, android.widget.Toast.LENGTH_SHORT).show();
            } catch (Throwable t) {
                android.widget.Toast.makeText(this, "Could not download this file", android.widget.Toast.LENGTH_SHORT).show();
            }
        });
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

    private int pageRetries = 0;

    /**
     * Capacitor swaps the whole app for the "Can't reach the server" page on any
     * failed page load or HTTP error, even one that clears a moment later
     * (changing tab, WiFi hopping, a dropped connection). Here a failed load is
     * retried quietly first, and an HTTP error status keeps the page the server
     * sent instead of replacing it.
     */
    private void quietErrors() {
        if (getBridge() == null) return;
        getBridge().setWebViewClient(
            new com.getcapacitor.BridgeWebViewClient(getBridge()) {
                @Override
                public void onReceivedHttpError(
                    android.webkit.WebView view,
                    android.webkit.WebResourceRequest request,
                    android.webkit.WebResourceResponse errorResponse
                ) {
                    // keep whatever the server returned (its own error page, a redirect...)
                }

                @Override
                public void onReceivedError(
                    android.webkit.WebView view,
                    android.webkit.WebResourceRequest request,
                    android.webkit.WebResourceError error
                ) {
                    if (request.isForMainFrame() && pageRetries < 3) {
                        pageRetries++;
                        final String url = request.getUrl().toString();
                        view.postDelayed(() -> view.loadUrl(url), 600L * pageRetries);
                        return;
                    }
                    super.onReceivedError(view, request, error);
                }

                @Override
                public void onPageFinished(android.webkit.WebView view, String url) {
                    super.onPageFinished(view, url);
                    pageRetries = 0;
                }
            }
        );
    }
}
