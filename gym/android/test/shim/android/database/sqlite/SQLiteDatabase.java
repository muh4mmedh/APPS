package android.database.sqlite;

import android.database.Cursor;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/*
 * Test stand-in for Android's SQLiteDatabase, on real SQLite via JDBC.
 * Mirrors Android's behaviour where GymDatabase relies on it: execSQL binds
 * nulls, errors throw SQLException (a RuntimeException), and a transaction
 * rolls back unless setTransactionSuccessful was called.
 */
public class SQLiteDatabase {
    public interface CursorFactory { }

    final Connection conn;
    private boolean success;

    SQLiteDatabase(Connection conn) { this.conn = conn; }

    public void execSQL(String sql) { execSQL(sql, new Object[0]); }

    public void execSQL(String sql, Object[] args) {
        try (PreparedStatement st = conn.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) st.setObject(i + 1, args[i]);
            st.execute();
        } catch (java.sql.SQLException e) {
            throw new android.database.SQLException(e.getMessage());
        }
    }

    public Cursor rawQuery(String sql, String[] args) {
        try (PreparedStatement st = conn.prepareStatement(sql)) {
            if (args != null) for (int i = 0; i < args.length; i++) st.setString(i + 1, args[i]);
            final List<Object[]> rows = new ArrayList<Object[]>();
            try (ResultSet rs = st.executeQuery()) {
                int n = rs.getMetaData().getColumnCount();
                while (rs.next()) {
                    Object[] row = new Object[n];
                    for (int i = 0; i < n; i++) row[i] = rs.getObject(i + 1);
                    rows.add(row);
                }
            }
            return new Cursor() {
                int at = -1;
                public boolean moveToNext() { return ++at < rows.size(); }
                public String getString(int c) { Object v = rows.get(at)[c]; return v == null ? null : v.toString(); }
                public int getInt(int c) { return ((Number) rows.get(at)[c]).intValue(); }
                public double getDouble(int c) { return ((Number) rows.get(at)[c]).doubleValue(); }
                public boolean isNull(int c) { return rows.get(at)[c] == null; }
                public void close() { }
            };
        } catch (java.sql.SQLException e) {
            throw new android.database.SQLException(e.getMessage());
        }
    }

    public void beginTransaction() {
        try { conn.setAutoCommit(false); success = false; }
        catch (java.sql.SQLException e) { throw new android.database.SQLException(e.getMessage()); }
    }

    public void setTransactionSuccessful() { success = true; }

    public void endTransaction() {
        try {
            if (success) conn.commit(); else conn.rollback();
            conn.setAutoCommit(true);
        } catch (java.sql.SQLException e) {
            throw new android.database.SQLException(e.getMessage());
        }
    }

    public void setForeignKeyConstraintsEnabled(boolean on) { execSQL("PRAGMA foreign_keys = " + (on ? "ON" : "OFF")); }

    int version() {
        try (Statement st = conn.createStatement(); ResultSet rs = st.executeQuery("PRAGMA user_version")) {
            return rs.getInt(1);
        } catch (java.sql.SQLException e) {
            throw new android.database.SQLException(e.getMessage());
        }
    }

    void close() {
        try { conn.close(); } catch (java.sql.SQLException ignored) { }
    }
}
