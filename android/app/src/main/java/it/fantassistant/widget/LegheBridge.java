// Created 14/10/2026 by Antonio Clemente (written with Claude).
package it.fantassistant.widget;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * THE PASS-THROUGH TO LEGHE, INSIDE THE APP (operator, 14/10/2026: «webview con bridge su app nativa»).
 *
 * Leghe's APIs answer CORS for `https://*.fantacalcio.it` only, so the webapp in a browser cannot call them and needs
 * a pass-through (`app/proxy.conf.mjs` under `ng serve`, the Worker `app/proxy/leghe-worker.mjs` for the published
 * site). The server itself checks nothing about the origin - only `app_key` and the league Bearer - so the same call
 * made from Java goes through. This class is that third pass-through: the page in `MainActivity`'s WebView calls
 * `window.FantAssistantApp.request(id, json)` (`app/src/app/core/leghe-api.ts`, `APP_BRIDGE`) and gets the answer
 * back through `window.__fantassistantBridge(id, status, text)`.
 *
 * IT FORWARDS AND DECIDES NOTHING, and it refuses to be an open relay - the Worker's rules, one for one: only the two
 * Leghe API hosts (the page names a PLATFORM, never a URL), only the paths the pages read, only GET and POST, only the
 * four headers those calls need. It logs nothing and stores nothing: a league token, and the EuroLeghe password of a
 * direct login, cross it in one request and are not kept.
 *
 * WHO CAN CALL IT: `addJavascriptInterface` exposes it to every frame of the WebView, and the WebView's main frame is
 * locked to the webapp's own address (`MainActivity.allowed`) - so the callers are the webapp and the one frame it
 * embeds, Leghe's own login page. The ANSWER is delivered to the main frame only (`evaluateJavascript`).
 */
final class LegheBridge {
    /** The two API hosts, by the platform the page names (`LEGHE` in `leghe-api.ts`). */
    private static final String CLASSIC = "https://apileague.fantacalcio.it";
    private static final String EURO = "https://apieuroleague.fantacalcio.it";

    /**
     * What the pages read and write: keep in step with `leghe-api.ts`, `leghe-session.ts` and the Worker's `PATHS`
     * (`app/proxy/leghe-worker.mjs`), which is the same list. Matched on the path WITHOUT its query string.
     */
    private static final List<Pattern> PATHS = Arrays.asList(
            Pattern.compile("^/onboarding/v1/login$"),
            Pattern.compile("^/onboarding/v1/league/(status|competitions|teams/my|teams)$"),
            Pattern.compile("^/onboarding/v1/league/settings/(lineup|calculate|rosters)$"),
            Pattern.compile("^/onboarding/v1/league/competition/calendar/\\d+$"),
            Pattern.compile("^/onboarding/v1/championship/teams$"),
            Pattern.compile("^/gaming/v1/teamLineup/visualizza/[A-Z]{1,2}/\\d+$"),
            Pattern.compile("^/gaming/v1/league/timing$"),
            // The save of the lineup (`leghe-api.saveLineup`): POST to the team's division, the team read from the token.
            Pattern.compile("^/gaming/v1/teamLineup/[A-Z]{1,2}$"));

    private static final List<String> FORWARDED = Arrays.asList("accept", "app_key", "authorization", "content-type");

    /** Above Leghe's normal answer time and below the page's own patience (`APP_TIMEOUT_MS`, 40 s). */
    private static final int CONNECT_MS = 10_000;
    private static final int READ_MS = 20_000;

    private final WebView web;
    /** One call at a time: the page already queues them (`SPACING_MS`), and a second lane here would undo that. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    LegheBridge(WebView web) {
        this.web = web;
    }

    /**
     * One request of the page, answered later through `window.__fantassistantBridge`. Its presence is also how the
     * page knows it runs inside the app (`leghe-api.appBridge`).
     */
    @JavascriptInterface
    public void request(String id, String json) {
        worker.execute(() -> {
            int status;
            String text;
            try {
                String[] answer = call(new JSONObject(json));
                status = Integer.parseInt(answer[0]);
                text = answer[1];
            } catch (Exception e) {
                // Status 0 = the request never got an answer: the page reads it as «Leghe non risponde (…)».
                status = 0;
                text = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            }
            answer(id, status, text);
        });
    }

    void close() {
        worker.shutdownNow();
    }

    /** One Leghe request: `[status, body]`, or a refusal of ours answered as Leghe answers a refusal. */
    private String[] call(JSONObject r) throws Exception {
        String platform = r.optString("platform");
        String host = "classic".equals(platform) ? CLASSIC : "euro".equals(platform) ? EURO : null;
        String method = r.optString("method");
        String path = r.optString("path");
        String bare = path.contains("?") ? path.substring(0, path.indexOf('?')) : path;
        if (host == null) return refusal("piattaforma sconosciuta");
        if (!"GET".equals(method) && !"POST".equals(method)) return refusal("metodo non ammesso");
        boolean known = false;
        for (Pattern p : PATHS) known |= p.matcher(bare).matches();
        if (!known) return refusal("percorso non ammesso dall'app: " + bare);

        HttpURLConnection c = (HttpURLConnection) new URL(host + path).openConnection();
        try {
            c.setConnectTimeout(CONNECT_MS);
            c.setReadTimeout(READ_MS);
            c.setRequestMethod(method);
            c.setInstanceFollowRedirects(false);
            JSONObject headers = r.optJSONObject("headers");
            if (headers != null) {
                for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                    String name = it.next();
                    if (FORWARDED.contains(name.toLowerCase(Locale.ROOT))) c.setRequestProperty(name, headers.optString(name));
                }
            }
            if ("POST".equals(method)) {
                byte[] body = r.isNull("body") ? new byte[0] : r.optString("body").getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(body);
                }
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            return new String[]{String.valueOf(status), in == null ? "" : read(in)};
        } finally {
            c.disconnect();
        }
    }

    /** A request this class will not forward, in the shape the page reads as «refused» with its reason. */
    private static String[] refusal(String why) throws Exception {
        JSONObject body = new JSONObject().put("success", false).put("code", "APP403").put("message", why);
        return new String[]{"403", body.toString()};
    }

    private static String read(InputStream in) throws Exception {
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int n;
            while ((n = stream.read(buffer)) > 0) out.write(buffer, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    /** Hands the answer to the page, on the UI thread, in the MAIN frame only. */
    private void answer(String id, int status, String text) {
        String script = "window.__fantassistantBridge&&window.__fantassistantBridge("
                + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text) + ")";
        web.post(() -> web.evaluateJavascript(script, null));
    }
}
