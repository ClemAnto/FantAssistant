package it.fantassistant.widget;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Serves the cached crests (`files/crests/{id}.png`) to the launcher as `content://it.fantassistant.widget.crests/{id}`.
 *
 * WHY A PROVIDER AND NOT A BITMAP (measured on the operator's moto g85, Android 16, 11/10/2026): a list row that
 * carries its crests as bitmaps makes the launcher's copy of the widget heavy (`views_bitmap_memory` 764,928 bytes
 * in `dumpsys appwidget`), and the list stopped after the 13th of 48 rows while the emulator drew them all. A URI
 * is a few bytes: the launcher reads the image itself, and no row carries pixels.
 *
 * Read-only and limited to that one folder: a crest is a public club badge, and the id is parsed as a number, so
 * the path cannot leave the folder.
 */
public class CrestProvider extends ContentProvider {
    static final String AUTHORITY = "it.fantassistant.widget.crests";

    static Uri uri(long id) {
        return Uri.parse("content://" + AUTHORITY + "/" + id);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        long id;
        try {
            id = Long.parseLong(uri.getLastPathSegment());
        } catch (Exception e) {
            throw new FileNotFoundException(String.valueOf(uri));
        }
        File f = new File(new File(getContext().getFilesDir(), "crests"), id + ".png");
        if (!f.exists()) throw new FileNotFoundException(String.valueOf(uri));
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "image/png";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
