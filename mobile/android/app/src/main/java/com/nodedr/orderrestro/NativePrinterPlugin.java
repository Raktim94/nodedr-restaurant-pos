package com.nodedr.orderrestro;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

/**
 * Printing from the phone itself, so receipts and kitchen tickets do not depend
 * on a printer plugged into the restaurant computer:
 *
 *  - btPrinters / btPrint: ESC/POS bytes to a paired Bluetooth thermal printer
 *    (the common 58 mm and 80 mm "mobile printers", serial profile).
 *  - printHtml: Android's own print dialog with the bill, which offers
 *    "Save as PDF" and every printer or print service installed on the phone.
 *
 * The bytes and the HTML come from the restaurant server.
 */
@CapacitorPlugin(
    name = "NativePrinter",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bluetooth")
    }
)
public class NativePrinterPlugin extends Plugin {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private WebView printView; // kept alive while the print dialog is open

    private boolean needsRuntimePermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    @PluginMethod
    public void btPrinters(PluginCall call) {
        if (needsRuntimePermission() && getPermissionState("bluetooth") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "listCallback");
            return;
        }
        list(call);
    }

    @PermissionCallback
    private void listCallback(PluginCall call) {
        if (getPermissionState("bluetooth") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("Bluetooth permission was not allowed. Allow it in the phone settings to find printers.");
            return;
        }
        list(call);
    }

    @SuppressWarnings("MissingPermission")
    private void list(PluginCall call) {
        BluetoothAdapter a = adapter();
        JSObject out = new JSObject();
        JSArray devices = new JSArray();
        out.put("enabled", a != null && a.isEnabled());
        out.put("supported", a != null);
        if (a != null && a.isEnabled()) {
            Set<BluetoothDevice> bonded = a.getBondedDevices();
            for (BluetoothDevice d : bonded) {
                JSObject o = new JSObject();
                o.put("name", d.getName() == null ? d.getAddress() : d.getName());
                o.put("address", d.getAddress());
                devices.put(o);
            }
        }
        out.put("devices", devices);
        call.resolve(out);
    }

    /** Sends base64 ESC/POS data to the paired printer at `address`. */
    @PluginMethod
    public void btPrint(PluginCall call) {
        if (needsRuntimePermission() && getPermissionState("bluetooth") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "printCallback");
            return;
        }
        write(call);
    }

    @PermissionCallback
    private void printCallback(PluginCall call) {
        if (getPermissionState("bluetooth") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("Bluetooth permission was not allowed. Allow it in the phone settings to print.");
            return;
        }
        write(call);
    }

    @SuppressWarnings("MissingPermission")
    private void write(final PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || address.isEmpty() || data == null || data.isEmpty()) {
            call.reject("Choose a Bluetooth printer first.");
            return;
        }
        final BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) {
            call.reject("Bluetooth is off. Turn it on and try again.");
            return;
        }
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothDevice dev = a.getRemoteDevice(address);
                a.cancelDiscovery();
                socket = dev.createRfcommSocketToServiceRecord(SPP);
                socket.connect();
                OutputStream out = socket.getOutputStream();
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                int chunk = 512;
                for (int i = 0; i < bytes.length; i += chunk) {
                    out.write(bytes, i, Math.min(chunk, bytes.length - i));
                    out.flush();
                    Thread.sleep(20);
                }
                Thread.sleep(300); // let the printer drain its buffer before closing
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not print on the Bluetooth printer. Check that it is switched on, paired and has paper. (" + e.getMessage() + ")");
            } finally {
                try {
                    if (socket != null) socket.close();
                } catch (Exception ignored) {}
            }
        }).start();
    }

    /** Opens Android's print dialog (Save as PDF, any installed printer) for an HTML document. */
    @PluginMethod
    public void printHtml(final PluginCall call) {
        final String html = call.getString("html");
        final String name = call.getString("name", "OrderRestro");
        if (html == null || html.isEmpty()) {
            call.reject("Nothing to print.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                final WebView view = new WebView(getContext());
                printView = view;
                view.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView v, String url) {
                        PrintManager pm = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                        pm.print(name, v.createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
                        call.resolve();
                    }
                });
                view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                call.reject("Could not open the print dialog: " + e.getMessage());
            }
        });
    }
}
