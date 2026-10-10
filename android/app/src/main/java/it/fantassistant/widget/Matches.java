package it.fantassistant.widget;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The Sheet's `?what=widget` payload (`scripts/gas/widget.gs`), read and nothing more: every string is already
 * formatted there («Oggi 20:45», «67'», «Finale»), so the phone does no date arithmetic and the two cannot
 * disagree about what a match's state is.
 */
final class Matches {
    static final class Row {
        String state = "";
        String title = "";
        String score = "";
        String when = "";
        String league = "";
        String players = "";
        String url = "";
        long start;

        boolean live() {
            return "live".equals(state);
        }
    }

    final String updated;
    final String text;
    final List<Row> rows;

    private Matches(String updated, String text, List<Row> rows) {
        this.updated = updated;
        this.text = text;
        this.rows = rows;
    }

    static final Matches EMPTY = new Matches("", "", Collections.emptyList());

    /** Null when the text is not that payload (a deployment without `widget.gs` answers something else). */
    static Matches parse(String json) {
        if (json == null) return null;
        try {
            JSONObject o = new JSONObject(json);
            if (!o.has("rows")) return null;
            JSONArray raw = o.getJSONArray("rows");
            List<Row> rows = new ArrayList<>();
            for (int i = 0; i < raw.length(); i++) {
                JSONObject r = raw.getJSONObject(i);
                Row row = new Row();
                row.state = r.optString("state");
                row.title = r.optString("title");
                row.score = r.optString("score");
                row.when = r.optString("when");
                row.league = r.optString("league");
                row.players = r.optString("players");
                row.url = r.optString("url");
                try {
                    row.start = Instant.parse(r.optString("start")).toEpochMilli();
                } catch (Exception ignored) {
                    row.start = 0L;
                }
                rows.add(row);
            }
            return new Matches(o.optString("updated"), o.optString("text"), rows);
        } catch (Exception e) {
            return null;
        }
    }
}
