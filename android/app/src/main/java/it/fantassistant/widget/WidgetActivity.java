package it.fantassistant.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.text.format.DateFormat;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * The WIDGET's screen: what to do, where the widget reads from (editable, because a NEW Apps Script deployment
 * changes the address), and a button that reads the list now and says how it went. Opening the app once also takes
 * it out of Android's «stopped» state, before which its alarms would not fire.
 *
 * Until 14/10/2026 this was the app's only screen (`MainActivity`). The app now opens on the webapp (`MainActivity`,
 * which kept the launcher's component name so an icon already on the home keeps working); this screen is reached
 * from the widget's title and from the app icon's long-press menu («Widget»).
 */
public class WidgetActivity extends Activity {
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

        // The webapp the app opens (`MainActivity`): rarely touched, so it sits under the widget's own settings.
        TextView webappLabel = new TextView(this);
        webappLabel.setText("Indirizzo della webapp che l'app apre:");
        webappLabel.setPadding(0, pad * 2, 0, 0);
        root.addView(webappLabel);
        EditText webapp = new EditText(this);
        webapp.setText(Store.webappUrl(this));
        webapp.setSingleLine(true);
        webapp.setTextSize(12);
        root.addView(webapp, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        Button saveWebapp = new Button(this);
        saveWebapp.setText("Salva e apri la webapp");
        saveWebapp.setOnClickListener(b -> {
            Store.setWebappUrl(this, webapp.getText().toString());
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
            finish();
        });
        root.addView(saveWebapp);

        // Scrollable since it carries two addresses: on a small screen the status at the bottom must stay reachable.
        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
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
        String list = Store.listReport(this);
        if (!list.isEmpty()) s.append("\n\n").append(list);
        s.append("\n\nVersione app: ").append(Store.version(this));
        status.setText(s.toString());
    }
}
