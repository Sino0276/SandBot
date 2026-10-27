package org.sandbot.tools;

import java.util.Collection;
import java.util.Map;

/** 빌드 보고용 작은 JSON 작성기(Map·Collection·String·Number·Boolean·null). */
final class Json {
    private Json() {}

    static String write(Object value) {
        StringBuilder out = new StringBuilder();
        write(value, out, "");
        return out.toString();
    }

    private static void write(Object value, StringBuilder out, String indent) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String) {
            string((String) value, out);
        } else if (value instanceof Number || value instanceof Boolean) {
            out.append(value);
        } else if (value instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) value;
            if (map.isEmpty()) {
                out.append("{}");
                return;
            }
            out.append("{\n");
            int i = 0;
            for (Map.Entry<?, ?> e : map.entrySet()) {
                out.append(indent).append("  ");
                string(String.valueOf(e.getKey()), out);
                out.append(": ");
                write(e.getValue(), out, indent + "  ");
                out.append(++i < map.size() ? ",\n" : "\n");
            }
            out.append(indent).append('}');
        } else if (value instanceof Collection) {
            Collection<?> list = (Collection<?>) value;
            if (list.isEmpty()) {
                out.append("[]");
                return;
            }
            out.append("[\n");
            int i = 0;
            for (Object item : list) {
                out.append(indent).append("  ");
                write(item, out, indent + "  ");
                out.append(++i < list.size() ? ",\n" : "\n");
            }
            out.append(indent).append(']');
        } else {
            string(value.toString(), out);
        }
    }

    private static void string(String s, StringBuilder out) {
        out.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c == '\n') out.append("\\n");
            else if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
            else out.append(c);
        }
        out.append('"');
    }
}
