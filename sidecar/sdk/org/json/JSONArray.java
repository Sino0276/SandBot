package org.json;

import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

// SandBot: Android org.json(API 19) JSONArray의 일부를 새로 쓴 것
public class JSONArray {
    private final List<Object> values;

    public JSONArray() {
        values = new ArrayList<>();
    }

    public JSONArray(Collection copyFrom) {
        this();
        if (copyFrom != null) for (Object value : copyFrom) put(JSONObject.wrap(value));
    }

    public JSONArray(String json) throws JSONException {
        JSON.Tokener tokener = new JSON.Tokener(json);
        Object object = tokener.nextValue();
        if (!(object instanceof JSONArray)) throw JSON.typeMismatch(object, "JSONArray");
        tokener.expectEnd();
        values = ((JSONArray) object).values;
    }

    public JSONArray(Object array) throws JSONException {
        if (!array.getClass().isArray()) throw new JSONException("Not a primitive array: " + array.getClass());
        int length = Array.getLength(array);
        values = new ArrayList<>(length);
        for (int i = 0; i < length; ++i) put(JSONObject.wrap(Array.get(array, i)));
    }

    public int length() {
        return values.size();
    }

    public JSONArray put(boolean value) {
        values.add(value);
        return this;
    }

    public JSONArray put(double value) throws JSONException {
        values.add(JSON.checkDouble(value));
        return this;
    }

    public JSONArray put(int value) {
        values.add(value);
        return this;
    }

    public JSONArray put(long value) {
        values.add(value);
        return this;
    }

    public JSONArray put(Object value) {
        values.add(value);
        return this;
    }

    public JSONArray put(int index, Object value) throws JSONException {
        if (value instanceof Number) JSON.checkDouble(((Number) value).doubleValue());
        while (values.size() <= index) values.add(null);
        values.set(index, value);
        return this;
    }

    public boolean isNull(int index) {
        Object value = opt(index);
        return value == null || value == JSONObject.NULL;
    }

    public Object get(int index) throws JSONException {
        try {
            Object value = values.get(index);
            if (value == null) throw new JSONException("Value at " + index + " is null.");
            return value;
        } catch (IndexOutOfBoundsException e) {
            throw new JSONException("Index " + index + " out of range [0.." + values.size() + ")");
        }
    }

    public Object opt(int index) {
        if (index < 0 || index >= values.size()) return null;
        return values.get(index);
    }

    public Object remove(int index) {
        if (index < 0 || index >= values.size()) return null;
        return values.remove(index);
    }

    public boolean getBoolean(int index) throws JSONException {
        Object object = get(index);
        Boolean result = JSON.toBoolean(object);
        if (result == null) throw JSON.typeMismatch(index, object, "boolean");
        return result;
    }

    public boolean optBoolean(int index) {
        return optBoolean(index, false);
    }

    public boolean optBoolean(int index, boolean fallback) {
        Boolean result = JSON.toBoolean(opt(index));
        return result != null ? result : fallback;
    }

    public double getDouble(int index) throws JSONException {
        Object object = get(index);
        Double result = JSON.toDouble(object);
        if (result == null) throw JSON.typeMismatch(index, object, "double");
        return result;
    }

    public double optDouble(int index) {
        return optDouble(index, Double.NaN);
    }

    public double optDouble(int index, double fallback) {
        Double result = JSON.toDouble(opt(index));
        return result != null ? result : fallback;
    }

    public int getInt(int index) throws JSONException {
        Object object = get(index);
        Integer result = JSON.toInteger(object);
        if (result == null) throw JSON.typeMismatch(index, object, "int");
        return result;
    }

    public int optInt(int index) {
        return optInt(index, 0);
    }

    public int optInt(int index, int fallback) {
        Integer result = JSON.toInteger(opt(index));
        return result != null ? result : fallback;
    }

    public long getLong(int index) throws JSONException {
        Object object = get(index);
        Long result = JSON.toLong(object);
        if (result == null) throw JSON.typeMismatch(index, object, "long");
        return result;
    }

    public long optLong(int index) {
        return optLong(index, 0L);
    }

    public long optLong(int index, long fallback) {
        Long result = JSON.toLong(opt(index));
        return result != null ? result : fallback;
    }

    public String getString(int index) throws JSONException {
        Object object = get(index);
        String result = JSON.toString(object);
        if (result == null) throw JSON.typeMismatch(index, object, "String");
        return result;
    }

    public String optString(int index) {
        return optString(index, "");
    }

    public String optString(int index, String fallback) {
        String result = JSON.toString(opt(index));
        return result != null ? result : fallback;
    }

    public JSONArray getJSONArray(int index) throws JSONException {
        Object object = get(index);
        if (object instanceof JSONArray) return (JSONArray) object;
        throw JSON.typeMismatch(index, object, "JSONArray");
    }

    public JSONArray optJSONArray(int index) {
        Object object = opt(index);
        return object instanceof JSONArray ? (JSONArray) object : null;
    }

    public JSONObject getJSONObject(int index) throws JSONException {
        Object object = get(index);
        if (object instanceof JSONObject) return (JSONObject) object;
        throw JSON.typeMismatch(index, object, "JSONObject");
    }

    public JSONObject optJSONObject(int index) {
        Object object = opt(index);
        return object instanceof JSONObject ? (JSONObject) object : null;
    }

    public String join(String separator) throws JSONException {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) out.append(separator);
            JSON.write(values.get(i), out);
        }
        return out.toString();
    }

    @Override
    public String toString() {
        StringBuilder out = new StringBuilder("[");
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) out.append(',');
            JSON.write(values.get(i), out);
        }
        return out.append(']').toString();
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof JSONArray && ((JSONArray) o).values.equals(values);
    }

    @Override
    public int hashCode() {
        return values.hashCode();
    }
}
