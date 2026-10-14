// Created 14/10/2026 by Antonio Clemente (written with Claude).
package it.fantassistant.widget;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * THE APP OPENS ON THE WEBAPP (operator, 14/10/2026: «un'app di facile consultazione per inserire la formazione e
 * proporre scambi guardando le statistiche» - and, asked native or WebView, «webview con bridge su app nativa»).
 *
 * The pages are the webapp's own, so every number on the phone is the number on the PC: the lineup's advice, the
 * press survey, the rulings, the full-season scale all live in TypeScript once. What the app adds is what a browser
 * cannot do: talk to Leghe without a pass-through (`LegheBridge`), because Leghe answers CORS to its own sites only.
 *
 * THE WEBVIEW SHOWS THE WEBAPP AND NOTHING ELSE: a main-frame navigation outside `Store.webappUrl` (a SofaScore link,
 * an odds page) opens in the phone's browser, so the bridge is only ever reachable from the webapp and the frame it
 * embeds (Leghe's own login). It survives a rotation (`configChanges` in the manifest): the league tokens live in the
 * page's `sessionStorage`, and a recreated WebView would lose them.
 */
public class MainActivity extends Activity {
    private WebView web;
    private LegheBridge bridge;
    private TextView failure;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.app_page));
        edgeToEdge(root);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        // localStorage (preferences, Leghe's cached readings) and sessionStorage (the league tokens).
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        // Without the network, the last copy of the pages instead of an error: the cached readings are still useful.
        s.setCacheMode(online() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        // The page can tell the app from a tab by the bridge; the agent says it too, with the version, for the logs.
        s.setUserAgentString(s.getUserAgentString() + " FantAssistantApp/" + Store.version(this));
        // Leghe's embedded login is a frame of leghe.fantacalcio.it inside our page: let it keep its own cookies.
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        bridge = new LegheBridge(web);
        web.addJavascriptInterface(bridge, "FantAssistantApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            /**
             * A WEBVIEW TOO OLD FOR THE WEBAPP says so instead of showing a blank page. Measured on an Android 11
             * emulator (WebView 83, 14/10/2026): the bundle does not even parse («Uncaught SyntaxError: Unexpected
             * token '{'»), and nothing on screen tells why. The WebView updates from the Play Store.
             */
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                String source = message.sourceId() == null ? "" : message.sourceId();
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR
                        && message.message() != null && message.message().contains("SyntaxError")
                        && source.startsWith(Store.webappUrl(MainActivity.this))) {
                    PackageInfo engine = WebView.getCurrentWebViewPackage();
                    failure.setText("La versione di Android System WebView di questo telefono ("
                            + (engine == null ? "?" : engine.versionName) + ") è troppo vecchia per la webapp.\n\n"
                            + "Aggiornala dal Play Store, poi tocca qui per riprovare.");
                    failure.setVisibility(View.VISIBLE);
                }
                return false;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        failure = new TextView(this);
        failure.setTextColor(getColor(R.color.app_fg));
        failure.setBackgroundColor(getColor(R.color.app_page));
        failure.setGravity(Gravity.CENTER);
        int pad = Math.round(24 * getResources().getDisplayMetrics().density);
        failure.setPadding(pad, pad, pad, pad);
        failure.setVisibility(View.GONE);
        failure.setOnClickListener(v -> {
            failure.setVisibility(View.GONE);
            web.reload();
        });
        root.addView(failure, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        web.loadUrl(start());
    }

    /** The page to open: the last one shown when it is still inside the webapp, the lineup otherwise. */
    private String start() {
        String base = Store.webappUrl(this);
        String last = Store.webappLast(this);
        return last != null && last.startsWith(base) ? last : base + "lineup";
    }

    /** Whether a main-frame address belongs to the webapp the app was set to show. */
    private boolean allowed(Uri url) {
        return url.toString().startsWith(Store.webappUrl(this));
    }

    private boolean online() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        return cm != null && cm.getActiveNetwork() != null;
    }

    private final class Client extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            failure.setVisibility(View.GONE);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Frames (Leghe's login) load where they load; only the MAIN frame is held to the webapp.
            if (!request.isForMainFrame() || allowed(request.getUrl())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
            } catch (ActivityNotFoundException ignored) {
                // No app opens that link: staying on the page is the only sensible answer.
            }
            return true;
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            // The webapp is a single page that changes its address by itself: this is where each page is seen.
            if (url != null && url.startsWith(Store.webappUrl(MainActivity.this))) Store.setWebappLast(MainActivity.this, url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            // An unreachable page is said in words and offers the way back, instead of the WebView's blank error.
            failure.setText("La webapp non si apre (" + error.getDescription() + ").\n\nTocca per riprovare.");
            failure.setVisibility(View.VISIBLE);
        }
    }

    /**
     * From Android 15 an app that targets it is drawn under the status and navigation bars, so the page is padded by
     * the bars (and by the keyboard, so a text field is never under it). Below Android 11 the system still lays the
     * window out between the bars and nothing is needed.
     */
    private void edgeToEdge(View root) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        getWindow().setDecorFitsSystemWindows(false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                    | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    @Override
    public void onBackPressed() {
        // Back walks the webapp's own history first, as in a browser; out of it, the app closes.
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) bridge.close();
        if (web != null) {
            web.removeJavascriptInterface("FantAssistantApp");
            web.destroy();
        }
        super.onDestroy();
    }
}
