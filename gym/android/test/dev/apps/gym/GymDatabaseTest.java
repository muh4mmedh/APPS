package dev.apps.gym;

import android.content.Context;
import android.database.Cursor;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.file.Files;

/*
 * Checks GymDatabase against real SQLite. Run with gym/android/test/run.sh.
 * Writes the loaded log to the path given as the first argument, so run.sh
 * can check that store.js accepts what the database hands back.
 */
public class GymDatabaseTest {
    static int failures = 0;

    static void check(String name, boolean ok) {
        System.out.println((ok ? "  ok   " : "  FAIL ") + name);
        if (!ok) failures++;
    }

    static int count(GymDatabase db, String table) {
        Cursor c = db.getReadableDatabase().rawQuery("SELECT count(*) FROM " + table, null);
        c.moveToNext();
        int n = c.getInt(0);
        c.close();
        return n;
    }

    /* Equal as JSON values: same keys, same numbers, nulls where nulls were. */
    static boolean same(Object a, Object b) {
        if (a == JSONObject.NULL || b == JSONObject.NULL) return a == b;
        if (a instanceof Number && b instanceof Number) return ((Number) a).doubleValue() == ((Number) b).doubleValue();
        if (a instanceof JSONObject && b instanceof JSONObject) {
            JSONObject x = (JSONObject) a, y = (JSONObject) b;
            if (!x.keySet().equals(y.keySet())) return false;
            for (String k : x.keySet()) if (!same(x.get(k), y.get(k))) return false;
            return true;
        }
        if (a instanceof JSONArray && b instanceof JSONArray) {
            JSONArray x = (JSONArray) a, y = (JSONArray) b;
            if (x.length() != y.length()) return false;
            for (int i = 0; i < x.length(); i++) if (!same(x.get(i), y.get(i))) return false;
            return true;
        }
        return a.equals(b);
    }

    static final String LOG = "{\"v\":1,\"unit\":\"lb\",\"sessions\":["
        + "{\"week\":\"2026-09-28\",\"dayId\":\"d1\",\"date\":\"2026-09-29\",\"knee\":\"off\",\"bw\":80.5,"
        +   "\"sets\":{\"incline-db\":[{\"w\":20,\"r\":12},null,{\"w\":17.5,\"r\":10}],\"fly\":[{\"w\":0,\"r\":15}]}},"
        + "{\"week\":\"2026-09-28\",\"dayId\":\"d3\",\"date\":\"2026-10-01\",\"knee\":null,\"bw\":null,"
        +   "\"sets\":{\"plank\":[{\"t\":30},{\"t\":45}],\"bridge\":[{\"r\":12}],\"cardio-3\":[{\"t\":20}]}},"
        + "{\"week\":\"2026-10-05\",\"dayId\":\"k\",\"date\":\"2026-10-07\",\"knee\":\"fine\",\"bw\":null,\"sets\":{}}"
        + "]}";

    public static void main(String[] args) throws Exception {
        File dir = Files.createTempDirectory("gymdb").toFile();
        Context context = new Context(dir);

        System.out.println("\nfresh install");
        GymDatabase db = new GymDatabase(context);
        JSONObject empty = new JSONObject(db.load());
        check("an empty database loads as an empty log in kg",
            empty.getJSONArray("sessions").length() == 0 && empty.getString("unit").equals("kg"));

        System.out.println("\nsave and load");
        check("saves a log", db.save(LOG));
        check("one row per session", count(db, "sessions") == 3);
        check("one row per logged set, skipped sets not stored", count(db, "sets") == 7);
        JSONObject back = new JSONObject(db.load());
        check("loads back exactly what was saved", same(new JSONObject(LOG), back));

        System.out.println("\nrestart and update");
        db.close();
        db = new GymDatabase(context);
        check("a new instance on the same file still has the log", same(new JSONObject(LOG), new JSONObject(db.load())));
        db.close();
        db = new GymDatabase(context);
        check("opening again does not recreate the tables", count(db, "sets") == 7);

        System.out.println("\nall or nothing");
        String broken = LOG.replace("\"dayId\":\"d3\",", "");
        check("a log with a damaged session is refused", !db.save(broken));
        check("and the stored log is untouched", same(new JSONObject(LOG), new JSONObject(db.load())));
        String badKnee = LOG.replace("\"knee\":\"off\"", "\"knee\":\"wobbly\"");
        check("a knee value outside fine/sore/off is refused", !db.save(badKnee));
        String badWeight = LOG.replace("\"w\":20,", "\"w\":-5,");
        check("a negative weight is refused", !db.save(badWeight));
        check("not JSON at all is refused", !db.save("{nope"));
        check("still untouched after all of that", same(new JSONObject(LOG), new JSONObject(db.load())));

        System.out.println("\nremoving");
        JSONObject fewer = new JSONObject(LOG);
        fewer.getJSONArray("sessions").remove(0);
        check("saving a shorter log works", db.save(fewer.toString()));
        check("the removed session's sets go with it", count(db, "sets") == 4 && count(db, "sessions") == 2);

        db.save(LOG);
        Files.write(new File(args[0]).toPath(), db.load().getBytes("UTF-8"));
        db.close();

        System.out.println("\n" + (failures == 0 ? "all database checks passed" : failures + " database check(s) failed") + "\n");
        System.exit(failures == 0 ? 0 : 1);
    }
}
