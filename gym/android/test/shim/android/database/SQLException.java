package android.database;

/* Same as Android's: unchecked, thrown for any SQL error. */
public class SQLException extends RuntimeException {
    public SQLException(String message) { super(message); }
}
