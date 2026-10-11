package it.fantassistant.widget;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * The clubs' crests, one PNG per SofaScore team id in the app's files, downloaded once and kept.
 *
 * The image host answers where SofaScore's API does not (`img.sofascore.com`: 200 from a PC that the API refuses
 * with 403), so the phone fetches the crests itself and the Sheet only says which ids. A crest barely changes, so
 * a file older than `MAX_AGE` is re-read and a failed download leaves the old file, or no crest, in place - never
 * an error: a missing crest is a row without a picture, not a broken row.
 *
 * The bitmap is scaled down before it travels: a RemoteViews carries its bitmaps across a binder transaction, and
 * thirty rows of 256px PNGs would not fit.
 */
final class Crests {
    private static final long MAX_AGE = 30L * 24 * 3600_000L;
    private static final int SIZE_PX = 48;

    private Crests() {
    }

    private static File file(Context context, long id) {
        File dir = new File(context.getFilesDir(), "crests");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, id + ".png");
    }

    /**
     * Downloads the crests the list names and the phone does not have (or has from over a month ago), each club
     * tried once per run. True when at least one new crest landed, so the caller knows whether to redraw.
     */
    static boolean ensure(Context context, Matches m) {
        if (m == null) return false;
        java.util.Set<Long> ids = new java.util.LinkedHashSet<>();
        for (Matches.Row r : m.rows) {
            ids.add(r.homeId);
            ids.add(r.awayId);
        }
        boolean any = false;
        for (long id : ids) any |= fetch(context, id);
        return any;
    }

    private static boolean fetch(Context context, long id) {
        if (id <= 0) return false;
        File f = file(context, id);
        if (f.exists() && System.currentTimeMillis() - f.lastModified() < MAX_AGE) return false;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("https://img.sofascore.com/api/v1/team/" + id + "/image").openConnection();
            c.setConnectTimeout(10_000);
            c.setReadTimeout(15_000);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) FantAssistant");
            if (c.getResponseCode() != 200) return false;
            Bitmap raw;
            try (InputStream in = c.getInputStream()) {
                raw = BitmapFactory.decodeStream(in);
            }
            if (raw == null) return false;
            Bitmap small = Bitmap.createScaledBitmap(raw, SIZE_PX, SIZE_PX, true);
            File tmp = new File(f.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                small.compress(Bitmap.CompressFormat.PNG, 100, out);
            }
            return tmp.renameTo(f);
        } catch (Exception ignored) {
            // No crest this time; the row draws without it and the next reading tries again.
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Whether the crest is on the phone (the list then points the launcher at it through `CrestProvider`). */
    static boolean has(Context context, long id) {
        return id > 0 && file(context, id).exists();
    }
}
