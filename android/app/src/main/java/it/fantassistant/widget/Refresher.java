package it.fantassistant.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Reads the list from the Sheet and schedules the next reading.
 *
 * THE CADENCE (operator, 10/10/2026: «se i risultati si aggiornano ogni 5 minuti andrebbe già bene»): every
 * 5 minutes while a match is being played, at the kick-off of the next one when it is near, and every 30 minutes
 * otherwise. The Sheet itself rebuilds the list every 5 minutes, so reading more often would only read the same
 * list. The alarm is inexact and does not wake the phone: a list nobody is looking at does not need refreshing,
 * and Android brings the widget up to date when the screen comes on.
 */
final class Refresher {
    private static final long FIVE_MIN = 5 * 60_000L;
    private static final long THIRTY_MIN = 30 * 60_000L;
    private static final int TRIES = 3;

    private Refresher() {
    }

    /** Fetches on a background thread, then redraws every widget; `done` runs at the end (a receiver's goAsync). */
    static void refresh(Context context, Runnable done) {
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                String body = fetch(Store.listUrl(app));
                if (Matches.parse(body) != null) {
                    Store.setJson(app, body);
                    Store.setError(app, "");
                } else {
                    Store.setError(app, "Il foglio non serve la lista del widget (va aggiunto widget.gs e ridistribuito)");
                }
            } catch (Exception e) {
                Store.setError(app, "Lettura non riuscita: " + e.getMessage());
            } finally {
                MatchesWidget.renderAll(app);
                schedule(app);
                if (done != null) done.run();
            }
        }).start();
    }

    /**
     * GET with redirects followed, three tries. Apps Script answers with a 302 to googleusercontent.com whose
     * one-time token sometimes does not resolve (measured on the press sheet: the second hop 404 twice in six), and a
     * new request gets a new token - so retrying repeats a request to a transport that fails by itself.
     */
    static String fetch(String url) throws Exception {
        Exception last = null;
        for (int attempt = 1; attempt <= TRIES; attempt++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20_000);
                c.setReadTimeout(30_000);
                int code = c.getResponseCode();
                if (code != 200) throw new Exception("il foglio ha risposto " + code);
                try (InputStream in = c.getInputStream()) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buffer = new byte[8192];
                    int n;
                    while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
                    return out.toString(StandardCharsets.UTF_8.name());
                }
            } catch (Exception e) {
                last = e;
                if (attempt < TRIES) Thread.sleep(800);
            } finally {
                if (c != null) c.disconnect();
            }
        }
        throw last;
    }

    /** The next reading, from what the list itself says is on. */
    static void schedule(Context context) {
        long now = System.currentTimeMillis();
        long delay = THIRTY_MIN;
        Matches m = Matches.parse(Store.json(context));
        if (m != null) {
            for (Matches.Row r : m.rows) {
                if (r.live()) {
                    delay = FIVE_MIN;
                    break;
                }
                if ("pre".equals(r.state) && r.start > now) delay = Math.min(delay, r.start - now);
            }
        }
        delay = Math.max(delay, FIVE_MIN);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        alarms.setAndAllowWhileIdle(AlarmManager.RTC, now + delay, tick(context));
    }

    static void cancel(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        alarms.cancel(tick(context));
    }

    private static PendingIntent tick(Context context) {
        Intent intent = new Intent(context, MatchesWidget.class).setAction(MatchesWidget.ACTION_TICK);
        return PendingIntent.getBroadcast(context, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
