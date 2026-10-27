package org.json;

// SandBot: org.json 형 변환 도움(Android org.json의 JSON 클래스와 같은 역할, 패키지 밖에 보이지 않음)
final class JSON {
    private JSON() {}

    static double checkDouble(double d) throws JSONException {
        if (Double.isInfinite(d) || Double.isNaN(d)) throw new JSONException("Forbidden numeric value: " + d);
        return d;
    }

    static Boolean toBoolean(Object value) {
        if (value instanceof Boolean) return (Boolean) value;
        if (value instanceof String) {
            String s = (String) value;
            if ("true".equalsIgnoreCase(s)) return true;
            if ("false".equalsIgnoreCase(s)) return false;
        }
        return null;
    }

    static Double toDouble(Object value) {
        if (value instanceof Double) return (Double) value;
        if (value instanceof Number) return ((Number) value).doubleValue();
        if (value instanceof String) {
            try {
                return Double.valueOf((String) value);
            } catch (NumberFormatException ignored) {
            }
        }
        return null;
    }

    static Integer toInteger(Object value) {
        if (value instanceof Integer) return (Integer) value;
        if (value instanceof Number) return ((Number) value).intValue();
        if (value instanceof String) {
            try {
                return (int) Double.parseDouble((String) value);
            } catch (NumberFormatException ignored) {
            }
        }
        return null;
    }

    static Long toLong(Object value) {
        if (value instanceof Long) return (Long) value;
        if (value instanceof Number) return ((Number) value).longValue();
        if (value instanceof String) {
            try {
                return (long) Double.parseDouble((String) value);
            } catch (NumberFormatException ignored) {
            }
        }
        return null;
    }

    static String toString(Object value) {
        if (value instanceof String) return (String) value;
        if (value != null) return String.valueOf(value);
        return null;
    }

    static JSONException typeMismatch(Object indexOrName, Object actual, String requiredType) {
        if (actual == null) return new JSONException("Value at " + indexOrName + " is null.");
        return new JSONException("Value " + actual + " at " + indexOrName + " of type " + actual.getClass().getName()
                + " cannot be converted to " + requiredType);
    }

    static JSONException typeMismatch(Object actual, String requiredType) {
        if (actual == null) return new JSONException("Value is null.");
        return new JSONException("Value " + actual + " of type " + actual.getClass().getName()
                + " cannot be converted to " + requiredType);
    }

    // 글자를 JSON으로 읽는다(객체·배열·글자·숫자·true/false/null)
    static final class Tokener {
        private final String in;
        private int pos;

        Tokener(String in) {
            this.in = in == null ? "" : in;
        }

        Object nextValue() throws JSONException {
            int c = nextClean();
            switch (c) {
                case -1:
                    throw error("End of input");
                case '{':
                    return readObject();
                case '[':
                    return readArray();
                case '"':
                case '\'':
                    return readString((char) c);
                default:
                    pos--;
                    return readLiteral();
            }
        }

        void expectEnd() throws JSONException {
            if (nextClean() != -1) throw error("Unexpected trailing characters");
        }

        private int nextClean() {
            while (pos < in.length()) {
                char c = in.charAt(pos++);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') continue;
                return c;
            }
            return -1;
        }

        private JSONObject readObject() throws JSONException {
            JSONObject result = new JSONObject();
            int first = nextClean();
            if (first == '}') return result;
            if (first == -1) throw error("Unterminated object");
            pos--;
            while (true) {
                Object name = nextValue();
                if (!(name instanceof String)) throw error("Names must be strings, but " + name + " is of type "
                        + (name == null ? "null" : name.getClass().getName()));
                int separator = nextClean();
                if (separator != ':' && separator != '=') throw error("Expected ':' after " + name);
                if (separator == '=' && pos < in.length() && in.charAt(pos) == '>') pos++;
                result.put((String) name, nextValue());
                int c = nextClean();
                if (c == '}') return result;
                if (c != ',' && c != ';') throw error("Unterminated object");
            }
        }

        private JSONArray readArray() throws JSONException {
            JSONArray result = new JSONArray();
            boolean hasTrailingSeparator = false;
            while (true) {
                int c = nextClean();
                if (c == -1) throw error("Unterminated array");
                if (c == ']') {
                    if (hasTrailingSeparator) result.put(null);
                    return result;
                }
                if (c == ',' || c == ';') {
                    result.put(null);
                    hasTrailingSeparator = true;
                    continue;
                }
                pos--;
                result.put(nextValue());
                c = nextClean();
                if (c == ']') return result;
                if (c != ',' && c != ';') throw error("Unterminated array");
                hasTrailingSeparator = true;
            }
        }

        private String readString(char quote) throws JSONException {
            StringBuilder out = new StringBuilder();
            while (pos < in.length()) {
                char c = in.charAt(pos++);
                if (c == quote) return out.toString();
                if (c != '\\') {
                    out.append(c);
                    continue;
                }
                if (pos >= in.length()) break;
                char e = in.charAt(pos++);
                switch (e) {
                    case 'u':
                        if (pos + 4 > in.length()) throw error("Unterminated escape sequence");
                        try {
                            out.append((char) Integer.parseInt(in.substring(pos, pos + 4), 16));
                        } catch (NumberFormatException ex) {
                            throw error("Invalid escape sequence");
                        }
                        pos += 4;
                        break;
                    case 't':
                        out.append('\t');
                        break;
                    case 'b':
                        out.append('\b');
                        break;
                    case 'n':
                        out.append('\n');
                        break;
                    case 'r':
                        out.append('\r');
                        break;
                    case 'f':
                        out.append('\f');
                        break;
                    default:
                        out.append(e);
                }
            }
            throw error("Unterminated string");
        }

        private Object readLiteral() throws JSONException {
            int start = pos;
            while (pos < in.length() && "\r\n\t ,:]}/\\\"[{;=#".indexOf(in.charAt(pos)) < 0) pos++;
            String literal = in.substring(start, pos);
            if (literal.isEmpty()) throw error("Expected literal value");
            if ("null".equalsIgnoreCase(literal)) return JSONObject.NULL;
            if ("true".equalsIgnoreCase(literal)) return Boolean.TRUE;
            if ("false".equalsIgnoreCase(literal)) return Boolean.FALSE;
            if (literal.indexOf('.') < 0 && literal.indexOf('e') < 0 && literal.indexOf('E') < 0) {
                try {
                    long l = Long.parseLong(literal);
                    if (l <= Integer.MAX_VALUE && l >= Integer.MIN_VALUE) return (int) l;
                    return l;
                } catch (NumberFormatException ignored) {
                }
            }
            try {
                return Double.valueOf(literal);
            } catch (NumberFormatException ignored) {
            }
            return literal;
        }

        private JSONException error(String message) {
            return new JSONException(message + " at character " + pos + " of " + in);
        }
    }

    static void quote(String s, StringBuilder out) {
        out.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                case '\\':
                case '/':
                    out.append('\\').append(c);
                    break;
                case '\t':
                    out.append("\\t");
                    break;
                case '\b':
                    out.append("\\b");
                    break;
                case '\n':
                    out.append("\\n");
                    break;
                case '\r':
                    out.append("\\r");
                    break;
                case '\f':
                    out.append("\\f");
                    break;
                default:
                    if (c <= 0x1F) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        out.append('"');
    }

    static void write(Object value, StringBuilder out) {
        if (value == null || value == JSONObject.NULL) {
            out.append("null");
        } else if (value instanceof JSONObject || value instanceof JSONArray) {
            out.append(value);
        } else if (value instanceof Boolean) {
            out.append(value);
        } else if (value instanceof Number) {
            out.append(JSONObject.numberToStringUnchecked((Number) value));
        } else {
            quote(value.toString(), out);
        }
    }
}
