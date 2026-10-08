package dev.apps.gym;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/*
 * The whole app is the web page in assets/www, shown in a WebView.
 *
 * It loads from file:///android_asset/, which needs no internet permission
 * and keeps localStorage between launches and app updates. The page needs
 * nothing that requires a secure context (no camera), so file:// is enough.
 *
 * The log itself is kept in SQLite (GymDatabase), which the page reaches
 * through GymAndroid.dbLoad / dbSave. Installing a newer APK over this one
 * keeps the database; only uninstalling removes it.
 *
 * What a browser does for free and a WebView does not is wired up here:
 *   - <input type="file"> (import a backup) opens the system file picker
 *   - export goes through GymAndroid.saveFile, which asks where to save,
 *     because a blob download link does nothing in a WebView
 *   - the back button walks back through the page's history first
 */
public class MainActivity extends Activity {
    private static final int PICK_FILE = 1;
    private static final int SAVE_FILE = 2;
    private static final String START = "file:///android_asset/www/index.html";

    private WebView web;
    private GymDatabase db;
    private ValueCallback<Uri[]> pickCallback;
    private String pendingText;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        db = new GymDatabase(this);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0A0C11);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " GymAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String link) {
                Uri url = Uri.parse(link);
                if ("file".equals(url.getScheme())) return false;
                // Anything off the device opens in the browser, not in here.
                try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
                catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pickCallback != null) pickCallback.onReceiveValue(null);
                pickCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                try {
                    startActivityForResult(pick, PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    pickCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "GymAndroid");

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(START);
        setContentView(web);
    }

    /* Called from the page. Methods run on a background thread. */
    private class Bridge {
        /* The whole log as JSON, or null if the database could not be read. */
        @JavascriptInterface
        public String dbLoad() {
            try { return db.load(); }
            catch (Exception e) { return null; }
        }

        /* Replaces the stored log; false (and nothing changed) on failure. */
        @JavascriptInterface
        public boolean dbSave(String json) {
            return db.save(json);
        }

        @JavascriptInterface
        public void saveFile(final String name, final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingText = text;
                    Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    save.addCategory(Intent.CATEGORY_OPENABLE);
                    save.setType("application/json");
                    save.putExtra(Intent.EXTRA_TITLE, name);
                    try {
                        startActivityForResult(save, SAVE_FILE);
                    } catch (ActivityNotFoundException e) {
                        pendingText = null;
                        tellPage(false);
                    }
                }
            });
        }
    }

    private void tellPage(boolean saved) {
        web.evaluateJavascript("window.gymSaved && window.gymSaved(" + saved + ")", null);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (request == PICK_FILE) {
            if (pickCallback != null) pickCallback.onReceiveValue(uri != null ? new Uri[] { uri } : null);
            pickCallback = null;
        } else if (request == SAVE_FILE) {
            boolean ok = false;
            if (uri != null && pendingText != null) {
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    out.write(pendingText.getBytes(StandardCharsets.UTF_8));
                    ok = true;
                } catch (Exception ignored) { }
            }
            pendingText = null;
            if (uri != null) tellPage(ok);
        } else {
            super.onActivityResult(request, result, data);
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        db.close();
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }
}
