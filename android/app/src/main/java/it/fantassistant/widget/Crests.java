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
        return new File(new File(context.getFilesDir(), "crests"), id + ".png");
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
        //noinspection ResultOfMethodCallIgnored
        f.getParentFile().mkdirs();
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

    /**
     * The crest's PREDOMINANT colour, for the dot before a club's men (operator, 20/10/2026), or 0 when the phone
     * has no crest. Opaque pixels are counted in coarse buckets and the commonest CHROMATIC bucket wins: a crest
     * is mostly a white field or a black outline around the club's colour, and «Roma = white» would say nothing.
     * Only a crest that is mostly black-and-white (under a fifth of its pixels coloured, e.g. Juventus) takes its
     * commonest grey - lifted to `minLuminance`, because a black dot vanishes on the widget's dark rows.
     */
    static int color(Context context, long id, float minLuminance) {
        if (!has(context, id)) return 0;
        Bitmap b = BitmapFactory.decodeFile(file(context, id).getPath());
        if (b == null) return 0;
        java.util.Map<Integer, int[]> chroma = new java.util.HashMap<>();
        java.util.Map<Integer, int[]> grey = new java.util.HashMap<>();
        int opaque = 0, coloured = 0;
        float[] hsv = new float[3];
        for (int y = 0; y < b.getHeight(); y++) {
            for (int x = 0; x < b.getWidth(); x++) {
                int p = b.getPixel(x, y);
                if ((p >>> 24) < 200) continue;
                opaque++;
                int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, bl = p & 0xFF;
                android.graphics.Color.RGBToHSV(r, g, bl, hsv);
                boolean isColour = hsv[1] > 0.30f && hsv[2] > 0.20f;
                if (isColour) coloured++;
                // 3 bits a channel: close shades of one colour (antialiasing, gradients) fall in one bucket.
                int key = ((r >> 5) << 6) | ((g >> 5) << 3) | (bl >> 5);
                int[] acc = (isColour ? chroma : grey).computeIfAbsent(key, k -> new int[4]);
                acc[0]++;
                acc[1] += r;
                acc[2] += g;
                acc[3] += bl;
            }
        }
        if (opaque == 0) return 0;
        int[] best = null;
        for (int[] acc : (coloured * 5 >= opaque ? chroma : grey).values()) {
            if (best == null || acc[0] > best[0]) best = acc;
        }
        if (best == null) return 0;
        int c = android.graphics.Color.rgb(best[1] / best[0], best[2] / best[0], best[3] / best[0]);
        // Mixed toward white until its luminance reaches the floor (~2.7:1 on the rows): Inter's navy and
        // Juventus's black would otherwise be a hole in the line, while Napoli's light blue stays as it is.
        for (float t = 0.02f; android.graphics.Color.luminance(c) < minLuminance && t <= 1f; t += 0.02f) {
            int r0 = best[1] / best[0], g0 = best[2] / best[0], b0 = best[3] / best[0];
            c = android.graphics.Color.rgb(Math.round(r0 + (255 - r0) * t), Math.round(g0 + (255 - g0) * t),
                    Math.round(b0 + (255 - b0) * t));
        }
        return c;
    }

    /** Whether the crest is on the phone (the list then points the launcher at it through `CrestProvider`). */
    static boolean has(Context context, long id) {
        return id > 0 && file(context, id).exists();
    }
}
