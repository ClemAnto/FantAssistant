package it.fantassistant.widget;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

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
        private List<Matches.Row> rows = Collections.emptyList();
        private boolean men = true;

        Factory(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {
        }

        @Override
        public void onDataSetChanged() {
            Matches m = Matches.parse(Store.json(context));
            rows = m == null ? Collections.emptyList() : m.rows;
            men = Store.showMen(context);
        }

        @Override
        public void onDestroy() {
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            Matches.Row r = rows.get(position);
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.row);
            v.setInt(R.id.row, "setBackgroundResource", r.live() ? R.drawable.row_live_bg : R.drawable.row_bg);
            v.setTextViewText(R.id.match, r.title);
            v.setTextViewText(R.id.score, r.score);
            v.setViewVisibility(R.id.score, r.score.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.when, r.when);
            v.setTextColor(R.id.when, context.getColor(r.live() ? R.color.live : R.color.muted));
            v.setTextViewText(R.id.league, r.league);
            boolean showMen = men && !r.players.isEmpty();
            v.setTextViewText(R.id.men, r.players);
            v.setViewVisibility(R.id.men, showMen ? View.VISIBLE : View.GONE);
            if (!r.url.isEmpty()) v.setOnClickFillInIntent(R.id.row, new Intent().setData(Uri.parse(r.url)));
            return v;
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
