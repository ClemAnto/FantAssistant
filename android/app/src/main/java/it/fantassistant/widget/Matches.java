package it.fantassistant.widget;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The Sheet's `?what=widget` payload (`scripts/gas/widget.gs`), read and nothing more: every string is already
 * formatted there («Oggi 20:45», «67'», «FT»), so the phone does no date arithmetic and the two cannot
 * disagree about what a match's state is.
 */
final class Matches {
    /** One of my men in one match, as `widget.gs` (`widgetManLine_`) wrote him. */
    static final class Man {
        String name = "";
        /** True / false once the match's line-up is known; null = not known (not started, or no id for him). */
        Boolean played;
        String on = "";
        String off = "";
        int goals;
        int assists;
        int penMissed;
        int penSaved;
        /** «home» or «away»; for a list written before the field existed, derived from `homePlayers`. */
        boolean away;
    }

    static final class Row {
        String state = "";
        String title = "";
        String home = "";
        String away = "";
        long homeId;
        long awayId;
        /** Each club's place in its championship's table, 0 when the Sheet does not know it. */
        int homePos;
        int awayPos;
        String score = "";
        String when = "";
        /** The label the widget groups this row under; see `groupLabel`. */
        String group = "";
        /** What the row's right column says: the minute, «FT», the hour of a later day, or nothing today. */
        String side = "";
        /**
         * The group's place in the list: the day, and «più tardi» right after today's. A match that was due at
         * 18:30 and has not started yet must not split today's group in two (measured on 10/10/2026: Barcelona
         * still «ore 18:30» between two live matches of the same kick-off).
         */
        long rank;
        String league = "";
        String players = "";
        String homePlayers = "";
        String awayPlayers = "";
        List<Man> men = new ArrayList<>();
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

    /**
     * «FT» and «HT», the operator's words (10/10/2026), also for a list written by a `widget.gs` that has not been
     * redeployed yet and still says «Finale» / «Intervallo».
     */
    private static String shortStatus(String when) {
        if ("Finale".equals(when)) return "FT";
        if ("Intervallo".equals(when)) return "HT";
        return when;
    }

    private static final String[] DAYS = {"lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"};

    /**
     * The groups the list is divided by (operator, 10/10/2026), on the phone's clock:
     *   --- giovedì 8/10 ---           a played day: the matches with their score and «FT»
     *   --- ieri, venerdì 9/10 ---
     *   --- oggi, sabato 10/10 ---     today's played and live matches (live: the minute)
     *   --- oggi, più tardi ---            today's matches yet to start, each with «ore 18:00»
     *   --- domani, domenica 11/10 --- a later day, each match with «ore 12:00»
     */
    private static void label(Row r) {
        if (r.start <= 0) {
            // No kick-off to file it under: last, without a label, rather than above the oldest day.
            r.group = "";
            r.side = r.when;
            r.rank = Long.MAX_VALUE;
            return;
        }
        java.time.ZonedDateTime t = Instant.ofEpochMilli(r.start).atZone(java.time.ZoneId.systemDefault());
        java.time.LocalDate day = t.toLocalDate();
        java.time.LocalDate today = java.time.LocalDate.now();
        String hour = String.format(java.util.Locale.ITALY, "ore %02d:%02d", t.getHour(), t.getMinute());
        boolean pre = "pre".equals(r.state);
        boolean later = pre && day.equals(today);
        r.group = later ? LATER : dayLabel(day, today);
        r.rank = day.toEpochDay() * 2 + (later ? 1 : 0);
        r.side = pre ? hour : r.when;
    }

    /** Today's matches yet to start (operator, 11/10/2026: «aggiungi all'etichetta "Oggi"», drawn green). */
    static final String LATER = "oggi, più tardi";

    private static String dayLabel(java.time.LocalDate day, java.time.LocalDate today) {
        String prefix = day.equals(today) ? "oggi, "
                : day.equals(today.minusDays(1)) ? "ieri, "
                : day.equals(today.plusDays(1)) ? "domani, " : "";
        return prefix + DAYS[day.getDayOfWeek().getValue() - 1] + " " + day.getDayOfMonth() + "/" + day.getMonthValue();
    }

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
                row.home = r.optString("home");
                row.away = r.optString("away");
                row.homeId = r.optLong("homeId");
                row.awayId = r.optLong("awayId");
                row.homePos = r.optInt("homePos");
                row.awayPos = r.optInt("awayPos");
                // «2-1», the operator's spelling, whatever spacing the Sheet writes.
                row.score = r.optString("score").replace(" ", "");
                row.when = shortStatus(r.optString("when"));
                row.league = r.optString("league");
                row.players = r.optString("players");
                row.homePlayers = r.optString("homePlayers");
                row.awayPlayers = r.optString("awayPlayers");
                JSONArray men = r.optJSONArray("men");
                if (men != null) {
                    int homeCount = row.homePlayers.isEmpty() ? 0 : row.homePlayers.split(", ").length;
                    for (int j = 0; j < men.length(); j++) {
                        JSONObject m = men.getJSONObject(j);
                        Man man = new Man();
                        man.name = m.optString("name");
                        man.played = m.isNull("played") || !m.has("played") ? null : m.optBoolean("played");
                        man.on = m.optString("on");
                        man.off = m.optString("off");
                        man.goals = m.optInt("goals");
                        man.assists = m.optInt("assists");
                        man.penMissed = m.optInt("penMissed");
                        man.penSaved = m.optInt("penSaved");
                        man.away = m.has("side") ? "away".equals(m.optString("side")) : j >= homeCount;
                        row.men.add(man);
                    }
                }
                row.url = r.optString("url");
                try {
                    row.start = Instant.parse(r.optString("start")).toEpochMilli();
                } catch (Exception ignored) {
                    row.start = 0L;
                }
                label(row);
                rows.add(row);
            }
            return new Matches(o.optString("updated"), o.optString("text"), rows);
        } catch (Exception e) {
            return null;
        }
    }
}
