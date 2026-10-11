package it.fantassistant.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.RemoteViews;

import java.util.List;

/**
 * THE WIDGET: the real matches of the clubs of the fantasquadra's men, each row opening the match on SofaScore,
 * with a «Nomi» switch that shows or hides the men under each match and a button that reads the list now.
 * The list itself is built by the Sheet (`scripts/gas/widget.gs`), which the app's Lineup page feeds.
 */
public class MatchesWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "it.fantassistant.widget.REFRESH";
    static final String ACTION_TOGGLE = "it.fantassistant.widget.TOGGLE_MEN";
    static final String ACTION_TICK = "it.fantassistant.widget.TICK";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        renderAll(context);
        PendingResult result = goAsync();
        Refresher.refresh(context, result::finish);
    }

    @Override
    public void onDisabled(Context context) {
        Refresher.cancel(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_TOGGLE.equals(action)) {
            Store.toggleMen(context);
            renderAll(context);
        } else if (ACTION_REFRESH.equals(action) || ACTION_TICK.equals(action)) {
            // A tap on the refresh glyph shows at once that it was taken (operator, 11/10/2026: «non si capisce
            // quando è stato premuto»): the header says «aggiornamento…» until the reading is done.
            if (ACTION_REFRESH.equals(action)) {
                Store.setRefreshing(context, true);
                renderAll(context);
            }
            PendingResult result = goAsync();
            Refresher.refresh(context, result::finish);
        } else {
            super.onReceive(context, intent);
        }
    }

    /** Redraws every widget from what is stored, and tells each list to reload its rows. */
    static void renderAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, MatchesWidget.class));
        Matches m = Matches.parse(Store.json(context));
        for (int id : ids) manager.updateAppWidget(id, views(context, id, m));
        manager.notifyAppWidgetViewDataChanged(ids, R.id.list);
    }

    /**
     * WHERE TO SCROLL so that «oggi» lands at the TOP. A widget list can only be scrolled with
     * `smoothScrollToPosition`, which moves just enough to make an item visible: from the top, the item ends at the
     * BOTTOM. So the target is the last item that still fits below today's label, estimated from the widget's height
     * and the rows' sizes (a label ~21dp, a match ~27dp, ~43dp with the men's line, 4dp between rows) - measured
     * on the emulator's screenshots, and only an estimate: a long men's line on two rows puts «oggi»
     * a little lower, never out of sight.
     */
    private static int scrollTarget(Context context, int id, List<Object> items, int today) {
        Bundle options = AppWidgetManager.getInstance(context).getAppWidgetOptions(id);
        int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (height <= 0) return today;
        int room = height - 52; // the header and the padding
        boolean men = Store.showMen(context);
        int used = 0;
        int target = today;
        for (int i = today; i < items.size(); i++) {
            Object it = items.get(i);
            int h = it instanceof String ? 21 : (men && !((Matches.Row) it).players.isEmpty() ? 43 : 27);
            used += h + 4;
            if (used > room) break;
            target = i;
        }
        return target;
    }

    private static RemoteViews views(Context context, int id, Matches m) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget);

        Intent service = new Intent(context, MatchesListService.class)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        service.setData(Uri.parse(service.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.list, service);
        v.setEmptyView(R.id.list, R.id.empty);
        // The list opens on today (operator, 11/10/2026: «di default fai scrollare la lista sempre ad "oggi"»):
        // yesterday's results stay above, one swipe away.
        List<Object> items = MatchesListService.items(m);
        int today = MatchesListService.todayIndex(items);
        if (today > 0) v.setScrollPosition(R.id.list, scrollTarget(context, id, items, today));

        String error = Store.error(context);
        if (m == null) v.setTextViewText(R.id.empty, error.isEmpty() ? "Caricamento…" : error);
        else if (m.rows.isEmpty()) v.setTextViewText(R.id.empty, m.text.isEmpty() ? "Nessuna partita" : m.text);
        // «agg. 16:05»: when the SHEET built the list, which is the age that matters; a «!» when the last read failed.
        // The app's version beside it (operator, 11/10/2026), so a screenshot says which APK drew it.
        String version = Store.version(context);
        boolean busy = Store.refreshing(context);
        v.setTextViewText(R.id.updated, busy ? "aggiornamento…"
                : (m == null ? "" : "agg. " + m.updated + (error.isEmpty() ? "" : " !") + " · ") + "v" + version);
        v.setTextColor(R.id.updated, context.getColor(busy ? R.color.live : R.color.muted));
        v.setTextColor(R.id.refresh, context.getColor(busy ? R.color.live : R.color.fg));
        v.setTextViewText(R.id.toggle_men, Store.showMen(context) ? "Nomi ✓" : "Nomi");

        v.setOnClickPendingIntent(R.id.toggle_men, broadcast(context, ACTION_TOGGLE, 2));
        v.setOnClickPendingIntent(R.id.refresh, broadcast(context, ACTION_REFRESH, 3));
        v.setOnClickPendingIntent(R.id.title, PendingIntent.getActivity(context, 4,
                new Intent(context, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        // A row's tap opens its SofaScore page: each row fills in the URL, so the template is mutable - and therefore
        // EXPLICIT (OpenActivity), because Android 14+ refuses a mutable PendingIntent around an implicit intent.
        Intent view = new Intent(context, OpenActivity.class);
        v.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(context, 5, view,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        return v;
    }

    private static PendingIntent broadcast(Context context, String action, int code) {
        Intent intent = new Intent(context, MatchesWidget.class).setAction(action);
        return PendingIntent.getBroadcast(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
