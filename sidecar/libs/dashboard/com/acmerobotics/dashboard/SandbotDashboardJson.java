package com.acmerobotics.dashboard;

import com.acmerobotics.dashboard.canvas.Alpha;
import com.acmerobotics.dashboard.canvas.CanvasOp;
import com.acmerobotics.dashboard.canvas.Circle;
import com.acmerobotics.dashboard.canvas.Fill;
import com.acmerobotics.dashboard.canvas.Grid;
import com.acmerobotics.dashboard.canvas.Image;
import com.acmerobotics.dashboard.canvas.Polygon;
import com.acmerobotics.dashboard.canvas.Polyline;
import com.acmerobotics.dashboard.canvas.Rotation;
import com.acmerobotics.dashboard.canvas.Scale;
import com.acmerobotics.dashboard.canvas.Spline;
import com.acmerobotics.dashboard.canvas.Stroke;
import com.acmerobotics.dashboard.canvas.StrokeWidth;
import com.acmerobotics.dashboard.canvas.Text;
import com.acmerobotics.dashboard.canvas.Translate;
import com.acmerobotics.dashboard.config.variable.CustomVariable;
import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import com.qualcomm.robotcore.util.RobotLog;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SortedMap;
import java.util.TreeMap;

/**
 * SandBot: Dashboard 패킷 묶음과 설정 트리를 프로토콜 JSON(src/shared/dashboard.ts, sidecarProtocol DashMessage·
 * DashConfigMessage)으로 쓴다. Gson을 쓰지 않고 손으로 쓴다: 필드 순서가 정해져 있고(같은 입력이면 같은 바이트), NaN·무한대를
 * 막고, 한도로 자를 수 있다. op 모양은 실제 Dashboard의 Gson 직렬화(필드 이름 그대로)와 같다.
 *
 * <p>op 클래스·TelemetryPacket의 필드는 private이라 리플렉션으로 읽는다(들여온 0.6.0 클래스의 필드 이름이 고정이다). 실제처럼
 * 하위 클래스도 받고(가장 가까운 아는 op 클래스의 필드), 아는 op 클래스가 아닌 CanvasOp는 버린다.
 *
 * <p>한도(넘으면 자르고 실행마다 한 번 RobotLog 경고): op 2000개, 다각형·선의 점 합 20000, data 키 500, 글자(키·값·로그 줄·글자
 * op·색·경로) 8192자, 로그 줄 200, 그리고 메시지 한 줄이 호스트 한도(4 MB)를 넘지 않게 data·log·ops·설정 트리 JSON의 글자 수.
 */
final class SandbotDashboardJson {
    // src/shared/dashboard.ts와 같은 값
    static final int MAX_OPS = 2000;
    static final int MAX_POINTS = 20_000;
    static final int MAX_DATA = 500;
    static final int MAX_TEXT = 8192;
    static final int MAX_LOG_LINES = 200;
    static final int MAX_CONFIG_NODES = 5000;
    static final int MAX_CONFIG_DEPTH = 16;
    // 메시지 하나의 JSON 글자 수(호스트의 한 줄 한도 4 MB 안: dash는 data + log + ops와 머리, dashConfig는 트리와 머리)
    static final int MAX_DATA_CHARS = 1 << 20;
    static final int MAX_LOG_CHARS = 256 * 1024;
    static final int MAX_OPS_CHARS = 2 << 20;
    // 넘으면 나머지 노드를 빼므로 마지막 값 노드 하나와 닫는 괄호만큼 넘을 수 있다(그래도 4 MB 안)
    static final int MAX_CONFIG_CHARS = 2 << 20;

    private static final String TAG = "FtcDashboard";

    /** 합친 묶음의 JSON 조각(log·ops는 null일 수 있다) */
    static final class Batch {
        final String data;
        final String log;
        final String ops;

        Batch(String data, String log, String ops) {
            this.data = data;
            this.log = log;
            this.ops = ops;
        }
    }

    private final Set<String> warned = new LinkedHashSet<>();

    /** 경고는 종류마다 실행에 한 번 */
    void warnOnce(String key, String message) {
        if (warned.add(key)) RobotLog.ww(TAG, message);
    }

    // ---- 패킷 묶음

    /**
     * 묶음을 호스트 화면 의미대로 합친다: data는 키마다 마지막 값(키 정렬), log는 마지막 비어 있지 않은 로그, ops는 마지막으로
     * fieldOverlay가 비어 있지 않은 패킷의 field op + fieldOverlay op. 실제 DashboardCore의 전송처럼 그 패킷 앞의 패킷들의
     * 캔버스(와 뒤의 빈 overlay 패킷의 field)를 비운다(팀 코드가 보내고 나서 캔버스를 보는 일은 드물지만 같게 둔다).
     */
    Batch batch(List<TelemetryPacket> packets) {
        // 실제 DashboardCore.TelemetryUpdateRunnable과 같은 순서로 비운다
        TelemetryPacket overlay = null;
        for (int i = packets.size() - 1; i >= 0; i--) {
            TelemetryPacket packet = packets.get(i);
            if (!packet.fieldOverlay().getOperations().isEmpty()) {
                overlay = packet;
                for (int j = 0; j < i; j++) {
                    TelemetryPacket packet2 = packets.get(j);
                    packet2.field().clear();
                    packet2.fieldOverlay().clear();
                }
                break;
            } else {
                packet.field().clear();
            }
        }

        SortedMap<String, String> data = new TreeMap<>();
        List<String> log = null;
        for (TelemetryPacket packet : packets) {
            Map<String, String> values = dataOf(packet);
            if (values != null) data.putAll(values);
            List<String> lines = logOf(packet);
            if (lines != null && !lines.isEmpty()) log = lines;
        }
        String ops = null;
        if (overlay != null) {
            List<CanvasOp> all = new ArrayList<>(overlay.field().getOperations());
            all.addAll(overlay.fieldOverlay().getOperations());
            ops = ops(all);
        }
        return new Batch(data(data), log == null ? null : log(log), ops);
    }

    /** 배열에 항목 하나를 더한다. 닫는 괄호까지 maxChars를 넘으면 더하지 않고 false. */
    private static boolean append(StringBuilder array, int count, CharSequence item, int maxChars) {
        if (array.length() + 1 + item.length() + 1 > maxChars) return false;
        if (count > 0) array.append(',');
        array.append(item);
        return true;
    }

    private String data(SortedMap<String, String> data) {
        StringBuilder out = new StringBuilder("[");
        StringBuilder item = new StringBuilder();
        int count = 0;
        for (Map.Entry<String, String> e : data.entrySet()) {
            item.setLength(0);
            item.append('[');
            string(item, clip(e.getKey(), "text"));
            item.append(',');
            string(item, clip(e.getValue() == null ? "null" : e.getValue(), "text"));
            item.append(']');
            if (count == MAX_DATA || !append(out, count, item, MAX_DATA_CHARS)) {
                warnOnce("data", "Dashboard telemetry has more than " + MAX_DATA
                        + " keys or is too large; the rest is not shown");
                break;
            }
            count++;
        }
        return out.append(']').toString();
    }

    private String log(List<String> lines) {
        StringBuilder out = new StringBuilder("[");
        StringBuilder item = new StringBuilder();
        int count = 0;
        for (String line : lines) {
            item.setLength(0);
            string(item, clip(line == null ? "null" : line, "text"));
            if (count == MAX_LOG_LINES || !append(out, count, item, MAX_LOG_CHARS)) {
                warnOnce("log", "the Dashboard telemetry log has more than " + MAX_LOG_LINES
                        + " lines or is too large; the rest is not shown");
                break;
            }
            count++;
        }
        return out.append(']').toString();
    }

    // ---- op

    private enum Kind {
        DOUBLE,
        INT,
        BOOLEAN,
        STRING,
        POINTS
    }

    private static final class OpType {
        final String type;
        final String[] names;
        final Kind[] kinds;
        final Field[] fields;

        OpType(Class<?> cls, String type, Object... spec) {
            this.type = type;
            int n = spec.length / 2;
            names = new String[n];
            kinds = new Kind[n];
            fields = new Field[n];
            for (int i = 0; i < n; i++) {
                names[i] = (String) spec[2 * i];
                kinds[i] = (Kind) spec[2 * i + 1];
                try {
                    fields[i] = cls.getDeclaredField(names[i]);
                    fields[i].setAccessible(true);
                } catch (NoSuchFieldException e) {
                    throw new IllegalStateException("FTC Dashboard " + cls.getName() + " has no field " + names[i], e);
                }
            }
        }
    }

    private static final Kind D = Kind.DOUBLE;
    private static final Kind I = Kind.INT;
    private static final Kind B = Kind.BOOLEAN;
    private static final Kind S = Kind.STRING;
    private static final Kind P = Kind.POINTS;

    /** 아는 op 클래스 → JSON 모양(필드 순서는 src/shared/dashboard.ts의 DashOp) */
    private static final Map<Class<?>, OpType> OP_TYPES = new LinkedHashMap<>();

    static {
        put(new OpType(Circle.class, "circle", "x", D, "y", D, "radius", D, "stroke", B), Circle.class);
        put(new OpType(Polygon.class, "polygon", "xPoints", P, "yPoints", P, "stroke", B), Polygon.class);
        put(new OpType(Polyline.class, "polyline", "xPoints", P, "yPoints", P), Polyline.class);
        put(new OpType(Spline.class, "spline", "ax", D, "bx", D, "cx", D, "dx", D, "ex", D, "fx", D, "ay", D, "by", D,
                "cy", D, "dy", D, "ey", D, "fy", D), Spline.class);
        put(new OpType(Text.class, "text", "text", S, "x", D, "y", D, "font", S, "theta", D, "stroke", B,
                "usePageFrame", B), Text.class);
        put(new OpType(Image.class, "image", "path", S, "x", D, "y", D, "width", D, "height", D, "theta", D, "pivotX",
                D, "pivotY", D, "usePageFrame", B), Image.class);
        put(new OpType(Grid.class, "grid", "x", D, "y", D, "width", D, "height", D, "numTicksX", I, "numTicksY", I,
                "theta", D, "pivotX", D, "pivotY", D, "usePageFrame", B), Grid.class);
        put(new OpType(Translate.class, "translate", "x", D, "y", D), Translate.class);
        put(new OpType(Rotation.class, "rotation", "rotation", D), Rotation.class);
        put(new OpType(Scale.class, "scale", "scaleX", D, "scaleY", D), Scale.class);
        put(new OpType(Fill.class, "fill", "color", S), Fill.class);
        put(new OpType(Stroke.class, "stroke", "color", S), Stroke.class);
        put(new OpType(StrokeWidth.class, "strokeWidth", "width", I), StrokeWidth.class);
        put(new OpType(Alpha.class, "alpha", "alpha", D), Alpha.class);
    }

    private static void put(OpType type, Class<?> cls) {
        OP_TYPES.put(cls, type);
    }

    private static OpType typeOf(CanvasOp op) {
        for (Class<?> c = op.getClass(); c != null && c != CanvasOp.class; c = c.getSuperclass()) {
            OpType type = OP_TYPES.get(c);
            if (type != null) return type;
        }
        return null;
    }

    private String ops(List<CanvasOp> list) {
        StringBuilder out = new StringBuilder("[");
        StringBuilder item = new StringBuilder();
        int count = 0;
        int points = 0;
        for (CanvasOp op : list) {
            if (count == MAX_OPS) {
                warnOnce("ops", "the Dashboard field overlay has more than " + MAX_OPS
                        + " operations or is too large; the rest is not drawn");
                break;
            }
            OpType type = op == null ? null : typeOf(op);
            if (type == null) {
                warnOnce("opType", "a Dashboard canvas operation of an unknown type ("
                        + (op == null ? "null" : op.getClass().getName()) + ") is not drawn");
                continue;
            }
            Object[] values = new Object[type.fields.length];
            int opPoints = 0;
            boolean valid = true;
            for (int i = 0; i < values.length && valid; i++) {
                try {
                    values[i] = type.fields[i].get(op);
                } catch (IllegalAccessException e) {
                    throw new IllegalStateException(e);
                }
                switch (type.kinds[i]) {
                    case DOUBLE:
                        valid = finite((Double) values[i]);
                        break;
                    case STRING:
                        valid = values[i] != null;
                        break;
                    case POINTS: {
                        double[] array = (double[]) values[i];
                        valid = array != null;
                        if (valid) {
                            for (double v : array) valid &= finite(v);
                            opPoints = Math.max(opPoints, array.length);
                        }
                        break;
                    }
                    default:
                        break;
                }
            }
            if (!valid) {
                warnOnce("invalid", "a Dashboard canvas operation (" + type.type
                        + ") has NaN, infinite or missing values and is not drawn");
                continue;
            }
            if (points + opPoints > MAX_POINTS) {
                warnOnce("points", "the Dashboard field overlay has more than " + MAX_POINTS
                        + " points; the rest is not drawn");
                continue;
            }
            item.setLength(0);
            item.append("{\"type\":");
            string(item, type.type);
            for (int i = 0; i < values.length; i++) {
                item.append(',');
                string(item, type.names[i]);
                item.append(':');
                Object value = values[i];
                switch (type.kinds[i]) {
                    case DOUBLE:
                        item.append(Double.toString((Double) value));
                        break;
                    case INT:
                        item.append(Integer.toString((Integer) value));
                        break;
                    case BOOLEAN:
                        item.append(((Boolean) value) ? "true" : "false");
                        break;
                    case STRING:
                        string(item, clip((String) value, "text"));
                        break;
                    case POINTS: {
                        item.append('[');
                        double[] array = (double[]) value;
                        for (int k = 0; k < array.length; k++) {
                            if (k > 0) item.append(',');
                            item.append(Double.toString(array[k]));
                        }
                        item.append(']');
                        break;
                    }
                    default:
                        throw new IllegalStateException();
                }
            }
            item.append('}');
            if (!append(out, count, item, MAX_OPS_CHARS)) {
                warnOnce("ops", "the Dashboard field overlay has more than " + MAX_OPS
                        + " operations or is too large; the rest is not drawn");
                break;
            }
            points += opPoints;
            count++;
        }
        return out.append(']').toString();
    }

    private static boolean finite(double v) {
        return !Double.isNaN(v) && !Double.isInfinite(v);
    }

    // ---- 설정 트리

    String config(CustomVariable root) {
        return SandbotDashboardConfig.tree(root, this);
    }

    // ---- TelemetryPacket의 private 필드

    private static final Field PACKET_DATA = packetField("data");
    private static final Field PACKET_LOG = packetField("log");

    private static Field packetField(String name) {
        try {
            Field field = TelemetryPacket.class.getDeclaredField(name);
            field.setAccessible(true);
            return field;
        } catch (NoSuchFieldException e) {
            throw new IllegalStateException("FTC Dashboard TelemetryPacket has no field " + name, e);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> dataOf(TelemetryPacket packet) {
        try {
            return (Map<String, String>) PACKET_DATA.get(packet);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<String> logOf(TelemetryPacket packet) {
        try {
            return (List<String>) PACKET_LOG.get(packet);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---- 글자

    /** {@link #MAX_TEXT}보다 길면 자르고 "…"를 붙인다(서로게이트 짝을 가르지 않는다) */
    String clip(String text, String warnKey) {
        if (text.length() <= MAX_TEXT) return text;
        warnOnce(warnKey, "a Dashboard text longer than " + MAX_TEXT + " characters was cut");
        int end = MAX_TEXT - 1;
        if (Character.isLowSurrogate(text.charAt(end)) && Character.isHighSurrogate(text.charAt(end - 1))) end--;
        return text.substring(0, end) + "…";
    }

    private static final char[] HEX = "0123456789abcdef".toCharArray();

    /** JSON 문자열(런타임 Json.writeString과 같은 규칙: " \ 제어 문자와 짝 없는 서로게이트를 이스케이프) */
    static void string(StringBuilder out, String s) {
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
}
