package it.fantassistant.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.os.Bundle;
import android.text.format.DateFormat;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The app's one screen: what to do, where the widget reads from (editable, because a NEW Apps Script deployment
 * changes the address), and a button that reads the list now and says how it went. Opening it once also takes
 * the app out of Android's «stopped» state, before which its alarms would not fire.
 */
public class MainActivity extends Activity {
    private TextView status;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad * 2, pad, pad);

        TextView intro = new TextView(this);
        intro.setText("1. Dalla webapp, pagina Formazione → Widget → «Invia questa squadra».\n"
                + "2. Tieni premuto sulla home → Widget → FantAssistant Partite.\n\n"
                + "Indirizzo del foglio (Apps Script):");
        root.addView(intro);

        EditText url = new EditText(this);
        url.setText(Store.url(this));
        url.setSingleLine(false);
        url.setTextSize(12);
        root.addView(url, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button save = new Button(this);
        save.setText("Salva e aggiorna");
        save.setOnClickListener(b -> {
            Store.setUrl(this, url.getText().toString());
            status.setText("Lettura in corso…");
            Refresher.refresh(this, () -> runOnUiThread(this::showStatus));
        });
        root.addView(save);

        // Puts the widget on the home screen with the launcher's own confirmation, so nobody has to look for it
        // in the widget list. Not every launcher supports it; the long-press route of the text above always works.
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        if (manager.isRequestPinAppWidgetSupported()) {
            Button pin = new Button(this);
            pin.setText("Aggiungi il widget alla home");
            pin.setOnClickListener(b -> manager.requestPinAppWidget(new ComponentName(this, MatchesWidget.class), null, null));
            root.addView(pin);
        }

        status = new TextView(this);
        status.setPadding(0, pad, 0, 0);
        root.addView(status);

        setContentView(root);
        showStatus();
    }

    private void showStatus() {
        Matches m = Matches.parse(Store.json(this));
        String error = Store.error(this);
        long at = Store.readAt(this);
        StringBuilder s = new StringBuilder();
        if (m != null) {
            s.append(m.rows.size()).append(" partite · lista del foglio delle ").append(m.updated);
            if (at > 0) s.append("\nletta alle ").append(DateFormat.format("HH:mm", at));
        } else {
            s.append("Nessuna lista ancora letta.");
        }
        if (!error.isEmpty()) s.append("\n\n").append(error);
        status.setText(s.toString());
    }
}
