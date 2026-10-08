package android.database;

/* Test stand-in for the part of Android's Cursor that GymDatabase uses. */
public interface Cursor extends java.io.Closeable {
    boolean moveToNext();
    String getString(int column);
    int getInt(int column);
    double getDouble(int column);
    boolean isNull(int column);
    void close();
}
