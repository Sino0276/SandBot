package org.sandbot.runtime;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 의존 없는 작은 JSON 파서·작성기(프로토콜 한 줄 = JSON 하나).
 *
 * <p>읽기: 객체 → LinkedHashMap(키 순서 유지, 같은 키는 마지막 값), 배열 → ArrayList, 문자열, true·false, null,
 * 숫자 → 소수점·지수가 없고 long에 들어가면 Long, 아니면 Double(long을 넘는 정수도 Double: JavaScript Number와 같은 정밀도).
 * "-0"은 Long 0. 잘못된 JSON은 위치를 담은 {@link JsonException}.
 *
 * <p>쓰기: Map(키는 String) → 객체, List·Collection·배열 → 배열, String, Boolean, null,
 * Long·Integer·Short·Byte·BigInteger → 정수, Double·Float → 유한하면 Java의 가장 짧은 표기(Double.toString), NaN·무한대는 null,
 * BigDecimal → toString. 문자열은 " \ 와 제어 문자(U+0000–U+001F)를 이스케이프하고, 짝이 없는 서로게이트도 \\uXXXX로 쓴다
 * (UTF-8로 쓸 수 없으므로). 그 밖의 글자는 그대로(UTF-8). 출력에 줄바꿈 글자가 없어 한 줄 프로토콜에 그대로 쓴다.
 */
public final class Json {
    private Json() {}

    public static final class JsonException extends Exception {
        public JsonException(String message) {
            super(message);
        }
    }

    // ---- 읽기 ----

    public static Object parse(String text) throws JsonException {
        Parser p = new Parser(text);
        p.skipSpace();
        Object value = p.value(0);
        p.skipSpace();
        if (p.pos != text.length()) throw p.error("unexpected trailing characters");
        return value;
    }

    private static final class Parser {
        private static final int MAX_DEPTH = 256;
        final String s;
        int pos;

        Parser(String s) {
            this.s = s;
        }

        JsonException error(String message) {
            return new JsonException(message + " at position " + pos);
        }

        void skipSpace() {
            while (pos < s.length()) {
                char c = s.charAt(pos);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') pos++;
                else break;
            }
        }

        Object value(int depth) throws JsonException {
            if (depth > MAX_DEPTH) throw error("nesting too deep");
            if (pos >= s.length()) throw error("unexpected end of input");
            char c = s.charAt(pos);
            switch (c) {
                case '{':
                    return object(depth);
                case '[':
                    return array(depth);
                case '"':
                    return string();
                case 't':
                    literal("true");
                    return Boolean.TRUE;
                case 'f':
                    literal("false");
                    return Boolean.FALSE;
                case 'n':
                    literal("null");
                    return null;
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) return number();
                    throw error("unexpected character '" + c + "'");
            }
        }

        void literal(String word) throws JsonException {
            if (!s.startsWith(word, pos)) throw error("invalid literal");
            pos += word.length();
        }

        Map<String, Object> object(int depth) throws JsonException {
            Map<String, Object> map = new LinkedHashMap<>();
            pos++; // {
            skipSpace();
            if (pos < s.length() && s.charAt(pos) == '}') {
                pos++;
                return map;
            }
            for (;;) {
                skipSpace();
                if (pos >= s.length() || s.charAt(pos) != '"') throw error("expected object key");
                String key = string();
                skipSpace();
                if (pos >= s.length() || s.charAt(pos) != ':') throw error("expected ':'");
                pos++;
                skipSpace();
                map.put(key, value(depth + 1));
                skipSpace();
                if (pos >= s.length()) throw error("unexpected end of input");
                char c = s.charAt(pos++);
                if (c == '}') return map;
                if (c != ',') {
                    pos--;
                    throw error("expected ',' or '}'");
                }
            }
        }

        List<Object> array(int depth) throws JsonException {
            List<Object> list = new ArrayList<>();
            pos++; // [
            skipSpace();
            if (pos < s.length() && s.charAt(pos) == ']') {
                pos++;
                return list;
            }
            for (;;) {
                skipSpace();
                list.add(value(depth + 1));
                skipSpace();
                if (pos >= s.length()) throw error("unexpected end of input");
                char c = s.charAt(pos++);
                if (c == ']') return list;
                if (c != ',') {
                    pos--;
                    throw error("expected ',' or ']'");
                }
            }
        }

        String string() throws JsonException {
            pos++; // "
            StringBuilder out = new StringBuilder();
            for (;;) {
                if (pos >= s.length()) throw error("unterminated string");
                char c = s.charAt(pos++);
                if (c == '"') return out.toString();
                if (c < 0x20) {
                    pos--;
                    throw error("control character in string");
                }
                if (c != '\\') {
                    out.append(c);
                    continue;
                }
                if (pos >= s.length()) throw error("unterminated escape");
                char e = s.charAt(pos++);
                switch (e) {
                    case '"':
                        out.append('"');
                        break;
                    case '\\':
                        out.append('\\');
                        break;
                    case '/':
                        out.append('/');
                        break;
                    case 'b':
                        out.append('\b');
                        break;
                    case 'f':
                        out.append('\f');
                        break;
                    case 'n':
                        out.append('\n');
                        break;
                    case 'r':
                        out.append('\r');
                        break;
                    case 't':
                        out.append('\t');
                        break;
                    case 'u': {
                        if (pos + 4 > s.length()) throw error("bad \\u escape");
                        int code = 0;
                        for (int i = 0; i < 4; i++) {
                            int d = Character.digit(s.charAt(pos + i), 16);
                            if (d < 0) throw error("bad \\u escape");
                            code = code * 16 + d;
                        }
                        pos += 4;
                        out.append((char) code);
                        break;
                    }
                    default:
                        pos--;
                        throw error("bad escape '\\" + e + "'");
                }
            }
        }

        Object number() throws JsonException {
            int start = pos;
            if (s.charAt(pos) == '-') pos++;
            if (pos >= s.length()) throw error("bad number");
            char c = s.charAt(pos);
            if (c == '0') {
                pos++;
            } else if (c >= '1' && c <= '9') {
                while (pos < s.length() && isDigit(s.charAt(pos))) pos++;
            } else {
                throw error("bad number");
            }
            boolean integral = true;
            if (pos < s.length() && s.charAt(pos) == '.') {
                integral = false;
                pos++;
                if (pos >= s.length() || !isDigit(s.charAt(pos))) throw error("bad number");
                while (pos < s.length() && isDigit(s.charAt(pos))) pos++;
            }
            if (pos < s.length() && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                integral = false;
                pos++;
                if (pos < s.length() && (s.charAt(pos) == '+' || s.charAt(pos) == '-')) pos++;
                if (pos >= s.length() || !isDigit(s.charAt(pos))) throw error("bad number");
                while (pos < s.length() && isDigit(s.charAt(pos))) pos++;
            }
            String text = s.substring(start, pos);
            if (integral) {
                try {
                    return Long.parseLong(text);
                } catch (NumberFormatException tooBig) {
                    // long을 넘는 정수: JavaScript처럼 double로
                }
            }
            return Double.parseDouble(text);
        }

        static boolean isDigit(char c) {
            return c >= '0' && c <= '9';
        }
    }

    // ---- 쓰기 ----

    public static String write(Object value) {
        StringBuilder out = new StringBuilder();
        write(out, value);
        return out.toString();
    }

    public static void write(StringBuilder out, Object value) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String) {
            writeString(out, (String) value);
        } else if (value instanceof Boolean) {
            out.append(((Boolean) value) ? "true" : "false");
        } else if (value instanceof Long || value instanceof Integer || value instanceof Short || value instanceof Byte
                || value instanceof BigInteger) {
            out.append(value.toString());
        } else if (value instanceof Double) {
            double d = (Double) value;
            if (Double.isNaN(d) || Double.isInfinite(d)) out.append("null");
            else out.append(Double.toString(d));
        } else if (value instanceof Float) {
            float f = (Float) value;
            if (Float.isNaN(f) || Float.isInfinite(f)) out.append("null");
            else out.append(Float.toString(f));
        } else if (value instanceof BigDecimal) {
            out.append(value.toString());
        } else if (value instanceof Map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) value).entrySet()) {
                if (!(e.getKey() instanceof String))
                    throw new IllegalArgumentException("JSON object keys must be strings: " + e.getKey());
                if (!first) out.append(',');
                first = false;
                writeString(out, (String) e.getKey());
                out.append(':');
                write(out, e.getValue());
            }
            out.append('}');
        } else if (value instanceof Collection) {
            out.append('[');
            boolean first = true;
            for (Object item : (Collection<?>) value) {
                if (!first) out.append(',');
                first = false;
                write(out, item);
            }
            out.append(']');
        } else if (value instanceof Object[]) {
            out.append('[');
            Object[] items = (Object[]) value;
            for (int i = 0; i < items.length; i++) {
                if (i > 0) out.append(',');
                write(out, items[i]);
            }
            out.append(']');
        } else {
            throw new IllegalArgumentException("cannot write " + value.getClass().getName() + " as JSON");
        }
    }

    private static final char[] HEX = "0123456789abcdef".toCharArray();

    public static void writeString(StringBuilder out, String s) {
        out.append('"');
        int n = s.length();
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    out.append("\\\"");
                    break;
                case '\\':
                    out.append("\\\\");
                    break;
                case '\n':
                    out.append("\\n");
                    break;
                case '\r':
                    out.append("\\r");
                    break;
                case '\t':
                    out.append("\\t");
                    break;
                case '\b':
                    out.append("\\b");
                    break;
                case '\f':
                    out.append("\\f");
                    break;
                default:
                    if (c < 0x20) {
                        unicodeEscape(out, c);
                    } else if (Character.isHighSurrogate(c)) {
                        if (i + 1 < n && Character.isLowSurrogate(s.charAt(i + 1))) {
                            out.append(c).append(s.charAt(i + 1));
                            i++;
                        } else {
                            unicodeEscape(out, c);
                        }
                    } else if (Character.isLowSurrogate(c)) {
                        unicodeEscape(out, c);
                    } else {
                        out.append(c);
                    }
            }
        }
        out.append('"');
    }

    private static void unicodeEscape(StringBuilder out, char c) {
        out.append("\\u").append(HEX[(c >> 12) & 0xF]).append(HEX[(c >> 8) & 0xF]).append(HEX[(c >> 4) & 0xF])
                .append(HEX[c & 0xF]);
    }

    /** 순서 있는 객체를 짧게 만든다: obj("type", "tick", "tick", 3) */
    public static Map<String, Object> obj(Object... keyValues) {
        if (keyValues.length % 2 != 0) throw new IllegalArgumentException("odd number of arguments");
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) map.put((String) keyValues[i], keyValues[i + 1]);
        return map;
    }
}
