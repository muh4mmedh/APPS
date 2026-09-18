package dev.apps.collection;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

/**
 * Hosts the whole app collection in a WebView.
 *
 * The one thing that matters here: the pages are served from
 * https://appassets.androidplatform.net/ rather than file://, through
 * WebViewAssetLoader. A file:// page is not a secure context, so getUserMedia
 * refuses to hand over the camera and the cube scanner cannot work at all.
 * Serving the same files over that https host makes it a secure context while
 * everything still comes from the APK's assets, with no network involved.
 */
public class MainActivity extends AppCompatActivity {

    private static final String START_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";
    private static final int CAMERA_REQUEST = 1;
    /** The page looks for this to tell it is running inside the APK. */
    private static final String SHELL_TAG = "AppsAndroidShell";

    private WebView web;
    private PermissionRequest pendingRequest;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // Everything ships inside the APK; nothing should be fetched.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setUserAgentString(settings.getUserAgentString() + " " + SHELL_TAG);

        /*
         * Requests a service worker makes do not pass through the WebViewClient
         * below — they need their own client. Without this, a service worker
         * would try to reach appassets.androidplatform.net over the real
         * network, which does not exist, and the page it served would be blank.
         * The page also stands down its own worker inside the shell (there is
         * nothing to cache when the files are already local), so this is the
         * backstop for a worker registered by an earlier version.
         */
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                    new ServiceWorkerClientCompat() {
                        @Override
                        public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                            return loader.shouldInterceptRequest(request.getUrl());
                        }
                    });
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                // Keep our own pages in here; hand anything else to the browser.
                if ("appassets.androidplatform.net".equals(url.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                    return false;
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                boolean wantsCamera = false;
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsCamera = true;
                }
                if (!wantsCamera) {
                    request.deny();
                    return;
                }
                // The page asking is ours, but Android still has to have granted
                // the app itself camera access first.
                if (hasCameraPermission()) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    pendingRequest = request;
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
                }
            }
        });

        // Match the site's background so there is no white flash on launch.
        web.setBackgroundColor(0xFF0A0C11);

        if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(START_URL);
        }
    }

    private boolean hasCameraPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, @NonNull String[] permissions,
                                           @NonNull int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != CAMERA_REQUEST || pendingRequest == null) return;
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            pendingRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            // The page handles this: it explains the camera is unavailable and
            // offers entering the colours by hand.
            pendingRequest.deny();
        }
        pendingRequest = null;
    }

    /** Back steps through the pages before it leaves the app. */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
