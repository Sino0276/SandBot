package org.json;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

// SandBot: Android org.json(API 19) JSONObject의 일부를 새로 쓴 것. 키는 넣은 순서로 둔다.
public class JSONObject {
    public static final Object NULL = new Object() {
        @Override
        public boolean equals(Object o) {
            return o == this || o == null;
        }

        @Override
        public int hashCode() {
            return 0;
        }

        @Override
        public String toString() {
            return "null";
        }
    };

    private final LinkedHashMap<String, Object> nameValuePairs = new LinkedHashMap<>();

    public JSONObject() {}

    public JSONObject(Map copyFrom) {
        for (Object e : copyFrom.entrySet()) {
            Map.Entry<?, ?> entry = (Map.Entry<?, ?>) e;
            String key = (String) entry.getKey();
            if (key == null) throw new NullPointerException("key == null");
            nameValuePairs.put(key, wrap(entry.getValue()));
        }
    }

    public JSONObject(String json) throws JSONException {
        JSON.Tokener tokener = new JSON.Tokener(json);
        Object object = tokener.nextValue();
        if (!(object instanceof JSONObject)) throw JSON.typeMismatch(object, "JSONObject");
        tokener.expectEnd();
        nameValuePairs.putAll(((JSONObject) object).nameValuePairs);
    }

    public int length() {
        return nameValuePairs.size();
    }

    public JSONObject put(String name, boolean value) throws JSONException {
        nameValuePairs.put(checkName(name), value);
        return this;
    }

    public JSONObject put(String name, double value) throws JSONException {
        nameValuePairs.put(checkName(name), JSON.checkDouble(value));
        return this;
    }

    public JSONObject put(String name, int value) throws JSONException {
        nameValuePairs.put(checkName(name), value);
        return this;
    }

    public JSONObject put(String name, long value) throws JSONException {
        nameValuePairs.put(checkName(name), value);
        return this;
    }

    public JSONObject put(String name, Object value) throws JSONException {
        if (value == null) {
            nameValuePairs.remove(name);
            return this;
        }
        if (value instanceof Number) JSON.checkDouble(((Number) value).doubleValue());
        nameValuePairs.put(checkName(name), value);
        return this;
    }

    public JSONObject putOpt(String name, Object value) throws JSONException {
        if (name == null || value == null) return this;
        return put(name, value);
    }

    String checkName(String name) throws JSONException {
        if (name == null) throw new JSONException("Names must be non-null");
        return name;
    }

    public Object remove(String name) {
        return nameValuePairs.remove(name);
    }

    public boolean isNull(String name) {
        Object value = nameValuePairs.get(name);
        return value == null || value == NULL;
    }

    public boolean has(String name) {
        return nameValuePairs.containsKey(name);
    }

    public Object get(String name) throws JSONException {
        Object result = nameValuePairs.get(name);
        if (result == null) throw new JSONException("No value for " + name);
        return result;
    }

    public Object opt(String name) {
        return nameValuePairs.get(name);
    }

    public boolean getBoolean(String name) throws JSONException {
        Object object = get(name);
        Boolean result = JSON.toBoolean(object);
        if (result == null) throw JSON.typeMismatch(name, object, "boolean");
        return result;
    }

    public boolean optBoolean(String name) {
        return optBoolean(name, false);
    }

    public boolean optBoolean(String name, boolean fallback) {
        Boolean result = JSON.toBoolean(opt(name));
        return result != null ? result : fallback;
    }

    public double getDouble(String name) throws JSONException {
        Object object = get(name);
        Double result = JSON.toDouble(object);
        if (result == null) throw JSON.typeMismatch(name, object, "double");
        return result;
    }

    public double optDouble(String name) {
        return optDouble(name, Double.NaN);
    }

    public double optDouble(String name, double fallback) {
        Double result = JSON.toDouble(opt(name));
        return result != null ? result : fallback;
    }

    public int getInt(String name) throws JSONException {
        Object object = get(name);
        Integer result = JSON.toInteger(object);
        if (result == null) throw JSON.typeMismatch(name, object, "int");
        return result;
    }

    public int optInt(String name) {
        return optInt(name, 0);
    }

    public int optInt(String name, int fallback) {
        Integer result = JSON.toInteger(opt(name));
        return result != null ? result : fallback;
    }

    public long getLong(String name) throws JSONException {
        Object object = get(name);
        Long result = JSON.toLong(object);
        if (result == null) throw JSON.typeMismatch(name, object, "long");
        return result;
    }

    public long optLong(String name) {
        return optLong(name, 0L);
    }

    public long optLong(String name, long fallback) {
        Long result = JSON.toLong(opt(name));
        return result != null ? result : fallback;
    }

    public String getString(String name) throws JSONException {
        Object object = get(name);
        String result = JSON.toString(object);
        if (result == null) throw JSON.typeMismatch(name, object, "String");
        return result;
    }

    public String optString(String name) {
        return optString(name, "");
    }

    public String optString(String name, String fallback) {
        String result = JSON.toString(opt(name));
        return result != null ? result : fallback;
    }

    public JSONArray getJSONArray(String name) throws JSONException {
        Object object = get(name);
        if (object instanceof JSONArray) return (JSONArray) object;
        throw JSON.typeMismatch(name, object, "JSONArray");
    }

    public JSONArray optJSONArray(String name) {
        Object object = opt(name);
        return object instanceof JSONArray ? (JSONArray) object : null;
    }

    public JSONObject getJSONObject(String name) throws JSONException {
        Object object = get(name);
        if (object instanceof JSONObject) return (JSONObject) object;
        throw JSON.typeMismatch(name, object, "JSONObject");
    }

    public JSONObject optJSONObject(String name) {
        Object object = opt(name);
        return object instanceof JSONObject ? (JSONObject) object : null;
    }

    public Iterator<String> keys() {
        return nameValuePairs.keySet().iterator();
    }

    public JSONArray names() {
        return nameValuePairs.isEmpty() ? null : new JSONArray(new ArrayList<String>(nameValuePairs.keySet()));
    }

    @Override
    public String toString() {
        StringBuilder out = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> entry : nameValuePairs.entrySet()) {
            if (!first) out.append(',');
            first = false;
            JSON.quote(entry.getKey(), out);
            out.append(':');
            JSON.write(entry.getValue(), out);
        }
        return out.append('}').toString();
    }

    public static String numberToString(Number number) throws JSONException {
        if (number == null) throw new JSONException("Number must be non-null");
        JSON.checkDouble(number.doubleValue());
        return numberToStringUnchecked(number);
    }

    static String numberToStringUnchecked(Number number) {
        double doubleValue = number.doubleValue();
        if (number.equals(doubleValue)) {
            long longValue = number.longValue();
            if (doubleValue == (double) longValue) return Long.toString(longValue);
        }
        return number.toString();
    }

    public static String quote(String data) {
        if (data == null) return "\"\"";
        StringBuilder out = new StringBuilder();
        JSON.quote(data, out);
        return out.toString();
    }

    public static Object wrap(Object o) {
        if (o == null) return NULL;
        if (o instanceof JSONArray || o instanceof JSONObject || o.equals(NULL)) return o;
        try {
            if (o instanceof Collection) return new JSONArray((Collection) o);
            if (o.getClass().isArray()) return new JSONArray(o);
            if (o instanceof Map) return new JSONObject((Map) o);
            if (o instanceof Boolean || o instanceof Byte || o instanceof Character || o instanceof Double
                    || o instanceof Float || o instanceof Integer || o instanceof Long || o instanceof Short
                    || o instanceof String) return o;
            if (o.getClass().getPackage() != null && o.getClass().getPackage().getName().startsWith("java.")) {
                return o.toString();
            }
        } catch (Exception ignored) {
        }
        return null;
    }
}
