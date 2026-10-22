package it.fantassistant.widget;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** The rows of the widget's list, one per match, read from the stored list on every reload. */
public class MatchesListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(),
                intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, 0));
    }

    /**
     * The list as drawn: a group label (a String) before the first match of each group, then its matches. ONE
     * definition, read by the rows and by the widget's empty text, or the two would count different lists.
     */
    static List<Object> items(Matches m, boolean withDone) {
        List<Object> out = new ArrayList<>();
        if (m == null) return out;
        String group = null;
        List<Matches.Row> sorted = new ArrayList<>();
        // A finished (or called-off) match is listed only when «Passate» is on.
        for (Matches.Row r : m.rows) if (withDone || !"done".equals(r.state)) sorted.add(r);
        // Stable: inside a group the Sheet's kick-off order stays.
        sorted.sort((a, b) -> Long.compare(a.rank, b.rank));
        for (Matches.Row r : sorted) {
            if (!r.group.equals(group)) {
                group = r.group;
                if (!group.isEmpty()) out.add(group);
            }
            out.add(r);
        }
        return out;
    }

    private static final class Factory implements RemoteViewsFactory {
        private final Context context;
        /**
         * The list as drawn: a group label (a String) before the first match of each group, then its matches
         * (operator, 10/10/2026: «raggruppiamo le partite per giorni, solo un'etichetta come divisore»; the
         * groups are `Matches.label`'s). The rows arrive sorted by kick-off from the Sheet.
         */
        private List<Object> items = Collections.emptyList();
        private boolean men = true;
        /** The highest row the launcher asked for since the last data change (for `Store.listReport`). */
        private int served = -1;
        /** Which crests are on the phone, looked up once per data change instead of twice per row per bind. */
        private final java.util.Map<Long, Boolean> crests = new java.util.HashMap<>();
        /** Each club's dot colour (`Crests.color`), read from its crest once per data change. */
        private final java.util.Map<Long, Integer> dots = new java.util.HashMap<>();
        /** A dot's colour is lifted to at least this luminance: a navy or black dot vanishes on the dark rows. */
        private static final float DOT_MIN_LUMINANCE = 0.12f;

        /** The widget this list belongs to, for its width (`menWidth`). */
        private final int widgetId;
        /** The px the men's line can use on one line, or 0 when the launcher has not said how wide the widget is. */
        private float menWidth;
        /** The men's line's own paint (11sp, `item.xml`), to measure whether both sides fit on one line. */
        private final android.text.TextPaint menPaint = new android.text.TextPaint();
        /** Horizontal padding between the widget's edge and the men's text: `widget.xml` 8+8, `item.xml` 8+8. */
        private static final int MEN_INSET_DP = 32;
        /** The space between two items, with my men shown and without. */
        private static final int GAP_WITH_MEN_DP = 8;
        private static final int GAP_DP = 4;

        Factory(Context context, int widgetId) {
            this.context = context;
            this.widgetId = widgetId;
        }

        @Override
        public void onCreate() {
        }

        @Override
        public void onDataSetChanged() {
            List<Object> out = items(Matches.parse(Store.json(context)), Store.showDone(context));
            items = out;
            served = -1;
            crests.clear();
            dots.clear();
            Store.setListPrepared(context, out.size());
            Store.setListError(context, "");
            men = Store.showMen(context);
            android.util.DisplayMetrics dm = context.getResources().getDisplayMetrics();
            menPaint.setTextSize(android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, 11, dm));
            // In portrait a widget is MIN_WIDTH wide (AppWidgetManager's own definition of the option).
            int dp = widgetId == 0 ? 0 : android.appwidget.AppWidgetManager.getInstance(context)
                    .getAppWidgetOptions(widgetId).getInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH);
            menWidth = dp <= MEN_INSET_DP ? 0 : (dp - MEN_INSET_DP) * dm.density;
        }

        @Override
        public void onDestroy() {
        }

        @Override
        public int getCount() {
            return items.size();
        }

        /**
         * A row that throws must not take the list with it: it is drawn as a line saying so, and the error is kept
         * for the app's screen (`Store.listReport`), which is the only place a failure inside a launcher is visible.
         */
        @Override
        public RemoteViews getViewAt(int position) {
            if (position > served) {
                served = position;
                Store.setListServed(context, position);
            }
            try {
                return view(position);
            } catch (Throwable t) {
                Store.setListError(context, "riga " + (position + 1) + ": " + t);
                RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.item);
                v.setViewVisibility(R.id.row, View.GONE);
                v.setViewVisibility(R.id.group_box, View.VISIBLE);
                v.setTextViewText(R.id.group, "errore: " + t.getClass().getSimpleName());
                return v;
            }
        }

        private RemoteViews view(int position) {
            Object item = items.get(position);
            // One layout, one view type (see `item.xml`): a label shows its half and hides the match's.
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.item);
            // The gap under each item (the list's divider is 0): wider when my men are shown under the matches,
            // the old 4dp when they are hidden (operator, 20/10/2026).
            int gap = Math.round((men ? GAP_WITH_MEN_DP : GAP_DP) * context.getResources().getDisplayMetrics().density);
            v.setViewPadding(R.id.item, 0, 0, 0, gap);
            boolean label = item instanceof String;
            v.setViewVisibility(R.id.group_box, label ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.row, label ? View.GONE : View.VISIBLE);
            if (label) {
                v.setTextViewText(R.id.group, (String) item);
                // «Oggi, più tardi» is the one divider drawn green: the matches still to come today.
                int tone = context.getColor(Matches.LATER.equals(item) ? R.color.later : R.color.muted);
                v.setTextColor(R.id.group, tone);
                v.setInt(R.id.line_l, "setBackgroundColor", tone);
                v.setInt(R.id.line_r, "setBackgroundColor", tone);
                return v;
            }
            Matches.Row r = (Matches.Row) item;
            v.setInt(R.id.row, "setBackgroundResource", r.live() ? R.drawable.row_live_bg : R.drawable.row_bg);
            // The two sides with their crests; a list from a `widget.gs` without `home`/`away` keeps the joined title.
            boolean split = !r.home.isEmpty() && !r.away.isEmpty();
            v.setTextViewText(R.id.home, split ? r.home : r.title.replace(" - ", " vs "));
            v.setViewVisibility(R.id.dash, split ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.away, split ? View.VISIBLE : View.GONE);
            v.setTextViewText(R.id.away, r.away);
            crest(v, R.id.home_crest, split ? r.homeId : 0);
            crest(v, R.id.away_crest, split ? r.awayId : 0);
            // A side with none of my men reads fainter (operator, 10/10/2026), so the eye goes to the clubs that matter.
            fade(v, R.id.home, R.id.home_crest, split && r.homePlayers.isEmpty() && !r.awayPlayers.isEmpty());
            fade(v, R.id.away, R.id.away_crest, split && r.awayPlayers.isEmpty() && !r.homePlayers.isEmpty());
            // The place in the championship's table, small beside the name (operator, 20/10/2026).
            pos(v, R.id.home_pos, split ? r.homePos : 0);
            pos(v, R.id.away_pos, split ? r.awayPos : 0);
            v.setTextViewText(R.id.score, r.score);
            v.setViewVisibility(R.id.score, r.score.isEmpty() ? View.GONE : View.VISIBLE);
            // What the group's label does not already say (see `Matches.label`).
            v.setTextViewText(R.id.when, r.side);
            v.setViewVisibility(R.id.when, r.side.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextColor(R.id.when, context.getColor(r.live() ? R.color.live : R.color.muted));
            // Once a match is over, the men who did not play are left out (operator, 11/10/2026); while it is being
            // played they stay, faint, because a substitute can still come on.
            List<Matches.Man> shown = new ArrayList<>();
            for (Matches.Man m : r.men) {
                if (!("done".equals(r.state) && Boolean.FALSE.equals(m.played))) shown.add(m);
            }
            boolean showMen = men && !r.players.isEmpty() && (r.men.isEmpty() || !shown.isEmpty());
            v.setTextViewText(R.id.men, r.men.isEmpty() ? plainLine(r) : menLine(r, shown));
            v.setViewVisibility(R.id.men, showMen ? View.VISIBLE : View.GONE);
            if (!r.url.isEmpty()) v.setOnClickFillInIntent(R.id.row, new Intent().setData(Uri.parse(r.url)));
            return v;
        }

        /**
         * The dot before a side's men, in the predominant colour of that club's crest (operator, 20/10/2026: «un
         * pallino prima dei nomi dei calciatori di ogni squadra ... del colore predominante del logo»). It replaced
         * the away side's darker white. No crest on the phone yet: the plain foreground, so the dot still separates.
         */
        private void dot(SpannableStringBuilder out, long clubId) {
            Integer c = dots.get(clubId);
            if (c == null) dots.put(clubId, c = Crests.color(context, clubId, DOT_MIN_LUMINANCE));
            int start = out.length();
            // A NO-BREAK space: the dot never ends a line with its first man on the next (operator, 20/10/2026).
            out.append("● ");
            out.setSpan(new ForegroundColorSpan(c != 0 ? c : context.getColor(R.color.fg)), start, start + 1,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }

        /** A list from a `widget.gs` without per-man detail: the two sides' names, each behind its club's dot. */
        private CharSequence plainLine(Matches.Row r) {
            if (r.homePlayers.isEmpty() && r.awayPlayers.isEmpty()) return r.players;
            List<SpannableStringBuilder> sides = new ArrayList<>();
            if (!r.homePlayers.isEmpty()) {
                SpannableStringBuilder s = new SpannableStringBuilder();
                dot(s, r.homeId);
                sides.add(s.append(r.homePlayers));
            }
            if (!r.awayPlayers.isEmpty()) {
                SpannableStringBuilder s = new SpannableStringBuilder();
                dot(s, r.awayId);
                sides.add(s.append(r.awayPlayers));
            }
            return join(sides);
        }

        private static void pos(RemoteViews v, int view, int position) {
            v.setTextViewText(view, position > 0 ? String.valueOf(position) : "");
            v.setViewVisibility(view, position > 0 ? View.VISIBLE : View.GONE);
        }

        private void fade(RemoteViews v, int text, int crest, boolean faint) {
            int fg = context.getColor(R.color.fg);
            v.setTextColor(text, faint ? (fg & 0x00FFFFFF) | 0x73000000 : fg);
            v.setInt(crest, "setImageAlpha", faint ? 115 : 255);
        }

        /**
         * My men in this match (operator, 10/10/2026): a man who did not play at 50% opacity, a green up-arrow and
         * the minute for one who came on, a red down-arrow and the minute for one who went off, a ball for every
         * goal (penalties included), a boot for every assist, a cross for a penalty missed and a glove for one
         * saved. A man the Sheet knows nothing about (match not
         * started, or no SofaScore id) is written plainly: not knowing is not «did not play».
         * Each side's men stand behind one dot in their club's colour (`dot`), home first.
         */
        private CharSequence menLine(Matches.Row r, List<Matches.Man> list) {
            List<SpannableStringBuilder> sides = new ArrayList<>();
            for (int side = 0; side < 2; side++) {
                boolean away = side == 1;
                SpannableStringBuilder out = null;
                for (Matches.Man m : list) {
                    if (m.away != away) continue;
                    if (out == null) {
                        out = new SpannableStringBuilder();
                        dot(out, away ? r.awayId : r.homeId);
                    } else {
                        out.append(",  ");
                    }
                    man(out, m);
                }
                if (out != null) sides.add(out);
            }
            return join(sides);
        }

        /**
         * The two sides on one line when they fit, the away side on a line of its own when they do not (operator,
         * 20/10/2026: «quando i calciatori delle due squadre non vanno tutti su una riga, vai a capo con la
         * seconda squadra»). Measured with the line's own paint on the widget's width; a launcher that does not say
         * the width gets the break, because a side starting mid-line is the thing being avoided.
         */
        private CharSequence join(List<SpannableStringBuilder> sides) {
            if (sides.size() < 2) return sides.isEmpty() ? "" : sides.get(0);
            SpannableStringBuilder one = new SpannableStringBuilder(sides.get(0)).append("     ").append(sides.get(1));
            if (menWidth > 0 && android.text.Layout.getDesiredWidth(one, menPaint) <= menWidth) return one;
            return new SpannableStringBuilder(sides.get(0)).append("\n").append(sides.get(1));
        }

        private void man(SpannableStringBuilder out, Matches.Man m) {
            int fg = context.getColor(R.color.fg_men);
            int start = out.length();
            out.append(m.name);
            if (Boolean.FALSE.equals(m.played)) {
                out.setSpan(new ForegroundColorSpan((fg & 0x00FFFFFF) | 0x80000000), start, out.length(),
                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                return;
            }
            for (int i = 0; i < m.goals; i++) out.append(" ⚽");
            for (int i = 0; i < m.assists; i++) out.append(" 👟");
            // A penalty missed (a cross) and a penalty saved (a keeper's glove), one mark each.
            for (int i = 0; i < m.penMissed; i++) out.append(" ❌");
            for (int i = 0; i < m.penSaved; i++) out.append(" 🧤");
            if (!m.on.isEmpty()) mark(out, " ▲" + m.on, context.getColor(R.color.sub_in));
            if (!m.off.isEmpty()) mark(out, " ▼" + m.off, context.getColor(R.color.sub_out));
        }

        private static void mark(SpannableStringBuilder out, String text, int color) {
            int start = out.length();
            out.append(text);
            out.setSpan(new ForegroundColorSpan(color), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            out.setSpan(new RelativeSizeSpan(0.85f), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }

        /** By URI (`CrestProvider`), never as a bitmap: pixels in every row is what cut the list short on a phone. */
        private void crest(RemoteViews v, int view, long id) {
            Boolean has = crests.get(id);
            if (has == null) crests.put(id, has = Crests.has(context, id));
            if (!has) {
                v.setViewVisibility(view, View.GONE);
            } else {
                v.setImageViewUri(view, CrestProvider.uri(id));
                v.setViewVisibility(view, View.VISIBLE);
            }
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }
    }
}
