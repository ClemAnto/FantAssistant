package it.fantassistant.widget;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
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
        return new Factory(getApplicationContext());
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
        /** The crests of this reading, decoded once per data change instead of twice per row per redraw. */
        private final java.util.Map<Long, Bitmap> crests = new java.util.HashMap<>();

        Factory(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {
        }

        @Override
        public void onDataSetChanged() {
            Matches m = Matches.parse(Store.json(context));
            List<Object> out = new ArrayList<>();
            String group = null;
            if (m != null) {
                List<Matches.Row> sorted = new ArrayList<>(m.rows);
                // Stable: inside a group the Sheet's kick-off order stays.
                sorted.sort((a, b) -> Long.compare(a.rank, b.rank));
                for (Matches.Row r : sorted) {
                    if (!r.group.equals(group)) {
                        group = r.group;
                        if (!group.isEmpty()) out.add(group);
                    }
                    out.add(r);
                }
            }
            items = out;
            crests.clear();
            Store.setListPrepared(context, out.size());
            Store.setListError(context, "");
            men = Store.showMen(context);
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
            Store.setListServed(context, position);
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
            boolean label = item instanceof String;
            v.setViewVisibility(R.id.group_box, label ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.row, label ? View.GONE : View.VISIBLE);
            if (label) {
                v.setTextViewText(R.id.group, (String) item);
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
            v.setTextViewText(R.id.score, r.score);
            v.setViewVisibility(R.id.score, r.score.isEmpty() ? View.GONE : View.VISIBLE);
            // What the group's label does not already say (see `Matches.label`).
            v.setTextViewText(R.id.when, r.side);
            v.setViewVisibility(R.id.when, r.side.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextColor(R.id.when, context.getColor(r.live() ? R.color.live : R.color.muted));
            boolean showMen = men && !r.players.isEmpty();
            v.setTextViewText(R.id.men, r.men.isEmpty() ? r.players
                    : menLine(r.men, !r.homePlayers.isEmpty() && !r.awayPlayers.isEmpty()));
            v.setViewVisibility(R.id.men, showMen ? View.VISIBLE : View.GONE);
            if (!r.url.isEmpty()) v.setOnClickFillInIntent(R.id.row, new Intent().setData(Uri.parse(r.url)));
            return v;
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
         * When both sides have men of mine, the away side's are a darker white (operator, 10/10/2026).
         */
        private CharSequence menLine(List<Matches.Man> list, boolean bothSides) {
            SpannableStringBuilder out = new SpannableStringBuilder();
            for (Matches.Man m : list) {
                if (out.length() > 0) out.append(",  ");
                int fg = context.getColor(bothSides && m.away ? R.color.fg_away : R.color.fg);
                int start = out.length();
                out.append(m.name);
                if (bothSides && m.away && !Boolean.FALSE.equals(m.played)) {
                    out.setSpan(new ForegroundColorSpan(fg), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                }
                if (Boolean.FALSE.equals(m.played)) {
                    out.setSpan(new ForegroundColorSpan((fg & 0x00FFFFFF) | 0x80000000), start, out.length(),
                            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    continue;
                }
                for (int i = 0; i < m.goals; i++) out.append(" ⚽");
                for (int i = 0; i < m.assists; i++) out.append(" 👟");
                // A penalty missed (a cross) and a penalty saved (a keeper's glove), one mark each.
                for (int i = 0; i < m.penMissed; i++) out.append(" ❌");
                for (int i = 0; i < m.penSaved; i++) out.append(" 🧤");
                if (!m.on.isEmpty()) mark(out, " ▲" + m.on, context.getColor(R.color.sub_in));
                if (!m.off.isEmpty()) mark(out, " ▼" + m.off, context.getColor(R.color.sub_out));
            }
            return out;
        }

        private static void mark(SpannableStringBuilder out, String text, int color) {
            int start = out.length();
            out.append(text);
            out.setSpan(new ForegroundColorSpan(color), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            out.setSpan(new RelativeSizeSpan(0.85f), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }

        private void crest(RemoteViews v, int view, long id) {
            Bitmap b = null;
            if (id > 0) {
                if (!crests.containsKey(id)) crests.put(id, Crests.get(context, id));
                b = crests.get(id);
            }
            if (b == null) {
                v.setViewVisibility(view, View.GONE);
            } else {
                v.setImageViewBitmap(view, b);
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
