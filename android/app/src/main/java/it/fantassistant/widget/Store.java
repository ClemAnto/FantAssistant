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

    static boolean showMen(Context context) {
        return prefs(context).getBoolean("men", true);
    }

    static void toggleMen(Context context) {
        prefs(context).edit().putBoolean("men", !showMen(context)).apply();
    }
}
