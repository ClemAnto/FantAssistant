package it.fantassistant.widget;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * What the widget keeps on the phone: the Sheet's address, the last list it read, and the «names» switch.
 *
 * The list is kept as the TEXT that arrived, so the widget draws at once from the last good reading and a refresh
 * that fails (Apps Script's second hop fails by itself now and then) leaves the previous list on screen instead of
 * an empty one - an unanswered request is not «no matches».
 */
final class Store {
    /**
     * The deployment the FantAssistant app already reads (`NEXT_ROUND_URL` in the app): the same Apps Script
     * project serves the probable line-ups, the odds and, on `?what=widget`, this list. Editable from the app's
     * screen, because a NEW Apps Script deployment changes the address.
     */
    static final String DEFAULT_URL =
            "https://script.google.com/macros/s/AKfycbz2zdQx_9o8GLfzEQ3StKQs7_McW7SY2e8o2fnodtHbHTQ7myfB7fVc_dr8VWH7W5vl/exec";

    private static final String PREFS = "widget";

    private Store() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String url(Context context) {
        return prefs(context).getString("url", DEFAULT_URL);
    }

    static void setUrl(Context context, String url) {
        prefs(context).edit().putString("url", url.trim()).apply();
    }

    /** The list's address: the deployment plus `what=widget`. */
    static String listUrl(Context context) {
        String base = url(context);
        return base + (base.contains("?") ? "&" : "?") + "what=widget";
    }

    static String json(Context context) {
        return prefs(context).getString("json", null);
    }

    static void setJson(Context context, String json) {
        prefs(context).edit().putString("json", json).putLong("readAt", System.currentTimeMillis()).apply();
    }

    static long readAt(Context context) {
        return prefs(context).getLong("readAt", 0L);
    }

    /** The last failure, shown in the app's screen; empty after a good reading. */
    static String error(Context context) {
        return prefs(context).getString("error", "");
    }

    static void setError(Context context, String error) {
        prefs(context).edit().putString("error", error == null ? "" : error).apply();
    }

    /**
     * What the widget's list ACTUALLY did, for the app's screen (10/10/2026: on the operator's phone the list showed
     * one match and a flash of the others, and the emulator could not reproduce it): how many items the last data
     * change prepared, the highest position the launcher asked for, and the last error a row threw.
     */
    static void setListPrepared(Context context, int items) {
        prefs(context).edit().putInt("listItems", items).putInt("listServed", -1)
                .putLong("listAt", System.currentTimeMillis()).apply();
    }

    static void setListServed(Context context, int position) {
        if (position > prefs(context).getInt("listServed", -1)) prefs(context).edit().putInt("listServed", position).apply();
    }

    static void setListError(Context context, String error) {
        prefs(context).edit().putString("listError", error).apply();
    }

    static String listReport(Context context) {
        SharedPreferences p = prefs(context);
        long at = p.getLong("listAt", 0L);
        if (at == 0L) return "";
        String s = "Widget: " + p.getInt("listItems", 0) + " righe preparate, richieste fino alla "
                + (p.getInt("listServed", -1) + 1) + " (" + android.text.format.DateFormat.format("HH:mm", at) + ")";
        String e = p.getString("listError", "");
        return e.isEmpty() ? s : s + "\nErrore di una riga: " + e;
    }

    /** The APK's versionName (`app/build.gradle`), or «?» when the package manager does not say. */
    static String version(Context context) {
        try {
            String v = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
            return v == null ? "?" : v;
        } catch (Exception e) {
            return "?";
        }
    }

    /** A refresh asked for by a tap and not finished yet: the widget's header says so. */
    static boolean refreshing(Context context) {
        return prefs(context).getBoolean("refreshing", false);
    }

    static void setRefreshing(Context context, boolean on) {
        prefs(context).edit().putBoolean("refreshing", on).commit();
    }

    /** Whether the finished matches are listed; off unless the operator turns it on. */
    static boolean showDone(Context context) {
        return prefs(context).getBoolean("done", false);
    }

    static void toggleDone(Context context) {
        prefs(context).edit().putBoolean("done", !showDone(context)).apply();
    }

    static boolean showMen(Context context) {
        return prefs(context).getBoolean("men", true);
    }

    static void toggleMen(Context context) {
        prefs(context).edit().putBoolean("men", !showMen(context)).apply();
    }
}
