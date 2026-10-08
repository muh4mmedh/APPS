package android.database.sqlite;

import android.content.Context;

import java.sql.DriverManager;

/*
 * Test stand-in for Android's SQLiteOpenHelper, with the same open logic:
 * onConfigure, then, inside a transaction, onCreate for a new file or
 * onUpgrade when the stored user_version is older, then store the version.
 */
public abstract class SQLiteOpenHelper {
    private final Context context;
    private final String name;
    private final int version;
    private SQLiteDatabase db;

    public SQLiteOpenHelper(Context context, String name, SQLiteDatabase.CursorFactory factory, int version) {
        this.context = context;
        this.name = name;
        this.version = version;
    }

    public void onConfigure(SQLiteDatabase db) { }
    public abstract void onCreate(SQLiteDatabase db);
    public abstract void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion);

    public synchronized SQLiteDatabase getWritableDatabase() {
        if (db != null) return db;
        try {
            db = new SQLiteDatabase(DriverManager.getConnection("jdbc:sqlite:" + context.getDatabasePath(name)));
        } catch (java.sql.SQLException e) {
            throw new android.database.SQLException(e.getMessage());
        }
        onConfigure(db);
        int current = db.version();
        if (current != version) {
            if (current > version) throw new IllegalStateException("cannot downgrade " + current + " to " + version);
            db.beginTransaction();
            try {
                if (current == 0) onCreate(db);
                else onUpgrade(db, current, version);
                db.execSQL("PRAGMA user_version = " + version);
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
        }
        return db;
    }

    public SQLiteDatabase getReadableDatabase() { return getWritableDatabase(); }

    public synchronized void close() {
        if (db != null) db.close();
        db = null;
    }
}
