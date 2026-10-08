package dev.apps.gym;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/*
 * The workout log, kept in SQLite (gym.db in the app's private storage).
 *
 * The file lives outside the APK, so installing a newer APK over the old one
 * keeps it. Only uninstalling removes it.
 *
 * The page works with the whole log as one JSON document, the same shape
 * store.js describes. load() builds that document from the tables, and
 * save() writes it back in one transaction. Either every row is written or
 * none are, so a crash or a bad document can never leave half a log behind.
 *
 * Tables
 *   settings  key/value pairs, currently just the weight unit
 *   sessions  one row per gym day per week, with the knee check and body weight
 *   sets      one row per logged set; deleted with its session
 */
final class GymDatabase extends SQLiteOpenHelper {
    static final String NAME = "gym.db";

    /*
     * Schema version. To change the tables later, raise this by one and add
     * a step to onUpgrade that alters what is there. Never drop or recreate
     * a table holding someone's log.
     */
    static final int VERSION = 1;

    GymDatabase(Context context) {
        super(context, NAME, null, VERSION);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE settings ("
            + " key TEXT PRIMARY KEY,"
            + " value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE sessions ("
            + " week TEXT NOT NULL,"                  // Monday of the week, 2026-10-05
            + " day_id TEXT NOT NULL,"                // d1..d4, k
            + " date TEXT NOT NULL,"                  // day the first set was logged
            + " knee TEXT CHECK (knee IN ('fine', 'sore', 'off')),"
            + " body_weight_kg REAL CHECK (body_weight_kg > 0),"
            + " PRIMARY KEY (week, day_id))");
        db.execSQL("CREATE TABLE sets ("
            + " week TEXT NOT NULL,"
            + " day_id TEXT NOT NULL,"
            + " exercise_id TEXT NOT NULL,"
            + " set_index INTEGER NOT NULL CHECK (set_index >= 0),"
            + " weight_kg REAL CHECK (weight_kg >= 0),"   // 0 is body weight
            + " reps INTEGER CHECK (reps >= 0),"
            + " duration REAL CHECK (duration >= 0),"     // seconds or minutes, per exercise
            + " PRIMARY KEY (week, day_id, exercise_id, set_index),"
            + " FOREIGN KEY (week, day_id) REFERENCES sessions (week, day_id) ON DELETE CASCADE)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int from, int to) {
        // Version 1 is the first schema; steps for later versions go here.
    }

    /* The whole log as JSON, in the shape store.js reads. */
    String load() throws JSONException {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject out = new JSONObject();
        out.put("v", 1);

        String unit = "kg";
        Cursor c = db.rawQuery("SELECT value FROM settings WHERE key = 'unit'", null);
        try {
            if (c.moveToNext()) unit = c.getString(0);
        } finally {
            c.close();
        }
        out.put("unit", unit);

        JSONArray sessions = new JSONArray();
        Map<String, JSONObject> byKey = new HashMap<String, JSONObject>();
        c = db.rawQuery("SELECT week, day_id, date, knee, body_weight_kg FROM sessions ORDER BY date, week, day_id", null);
        try {
            while (c.moveToNext()) {
                JSONObject s = new JSONObject();
                s.put("week", c.getString(0));
                s.put("dayId", c.getString(1));
                s.put("date", c.getString(2));
                s.put("knee", c.isNull(3) ? JSONObject.NULL : c.getString(3));
                s.put("bw", c.isNull(4) ? JSONObject.NULL : (Object) c.getDouble(4));
                s.put("sets", new JSONObject());
                sessions.put(s);
                byKey.put(c.getString(0) + "\n" + c.getString(1), s);
            }
        } finally {
            c.close();
        }

        c = db.rawQuery("SELECT week, day_id, exercise_id, set_index, weight_kg, reps, duration FROM sets"
            + " ORDER BY week, day_id, exercise_id, set_index", null);
        try {
            while (c.moveToNext()) {
                JSONObject s = byKey.get(c.getString(0) + "\n" + c.getString(1));
                if (s == null) continue;
                JSONObject sets = s.getJSONObject("sets");
                String exercise = c.getString(2);
                JSONArray list = sets.optJSONArray(exercise);
                if (list == null) {
                    list = new JSONArray();
                    sets.put(exercise, list);
                }
                // Sets not logged are nulls in the list, so set 3 stays set 3.
                int index = c.getInt(3);
                while (list.length() < index) list.put(JSONObject.NULL);
                JSONObject entry = new JSONObject();
                if (!c.isNull(4)) entry.put("w", c.getDouble(4));
                if (!c.isNull(5)) entry.put("r", c.getInt(5));
                if (!c.isNull(6)) entry.put("t", c.getDouble(6));
                list.put(entry);
            }
        } finally {
            c.close();
        }

        out.put("sessions", sessions);
        return out.toString();
    }

    /* Replaces the stored log with this one. False, and nothing changed, if it fails. */
    boolean save(String json) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            JSONObject in = new JSONObject(json);
            db.execSQL("DELETE FROM sets");
            db.execSQL("DELETE FROM sessions");
            db.execSQL("INSERT OR REPLACE INTO settings (key, value) VALUES ('unit', ?)",
                new Object[] { in.optString("unit", "kg") });

            JSONArray sessions = in.getJSONArray("sessions");
            for (int i = 0; i < sessions.length(); i++) {
                JSONObject s = sessions.getJSONObject(i);
                String week = s.getString("week");
                String day = s.getString("dayId");
                db.execSQL("INSERT INTO sessions (week, day_id, date, knee, body_weight_kg) VALUES (?, ?, ?, ?, ?)",
                    new Object[] { week, day, s.getString("date"), text(s, "knee"), number(s, "bw") });

                JSONObject sets = s.getJSONObject("sets");
                Iterator<String> exercises = sets.keys();
                while (exercises.hasNext()) {
                    String exercise = exercises.next();
                    JSONArray list = sets.getJSONArray(exercise);
                    for (int j = 0; j < list.length(); j++) {
                        if (list.isNull(j)) continue;
                        JSONObject e = list.getJSONObject(j);
                        Double reps = number(e, "r");
                        db.execSQL("INSERT INTO sets (week, day_id, exercise_id, set_index, weight_kg, reps, duration)"
                            + " VALUES (?, ?, ?, ?, ?, ?, ?)",
                            new Object[] { week, day, exercise, j, number(e, "w"),
                                reps == null ? null : (Object) Math.round(reps), number(e, "t") });
                    }
                }
            }
            db.setTransactionSuccessful();
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            db.endTransaction();
        }
    }

    private static String text(JSONObject o, String key) throws JSONException {
        return o.has(key) && !o.isNull(key) ? o.getString(key) : null;
    }

    private static Double number(JSONObject o, String key) throws JSONException {
        return o.has(key) && !o.isNull(key) ? o.getDouble(key) : null;
    }
}
