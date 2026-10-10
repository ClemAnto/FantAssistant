package it.fantassistant.widget;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * The step between a row's tap and SofaScore. A list row's click completes a MUTABLE template (each row fills in
 * its URL), and from Android 14 a mutable PendingIntent may not carry an implicit intent - measured on the
 * emulator: `IllegalArgumentException ... disallows creating ... FLAG_MUTABLE, an implicit Intent`. So the
 * template targets this activity explicitly, and this opens the URL and closes, without drawing anything.
 */
public class OpenActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri uri = getIntent().getData();
        if (uri != null) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
                // No browser and no SofaScore app: nothing to open.
            }
        }
        finish();
    }
}
