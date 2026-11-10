package org.sandbot.runtime;

import org.sandbot.testing.Check;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 의존 없는 JSON(프로토콜 한 줄) 읽기·쓰기 */
public final class JsonTest {
    private JsonTest() {}

    public static void testParsesValues() throws Exception {
        Check.equal(Json.obj("a", 1L, "b", Arrays.asList(true, false, null), "c", "x"),
                Json.parse(" {\"a\":1, \"b\" : [true,false,null] ,\"c\":\"x\"} "), "object");
        Check.equal(Collections.emptyList(), Json.parse("[]"), "empty array");
        Check.equal(new LinkedHashMap<>(), Json.parse("{}"), "empty object");
        Check.equal("", Json.parse("\"\""), "empty string");
    }

    public static void testNumbers() throws Exception {
        Check.equal(0L, Json.parse("0"), "zero");
        Check.equal(0L, Json.parse("-0"), "-0 is Long 0");
        Check.equal(-12L, Json.parse("-12"), "negative");
        Check.equal(Long.MAX_VALUE, Json.parse("9223372036854775807"), "long max");
        Check.equal(9.223372036854775808E18, Json.parse("9223372036854775808"), "past long → double");
        Check.equal(1.5, Json.parse("1.5"), "fraction");
        Check.equal(1000.0, Json.parse("1e3"), "exponent is a double");
        Check.equal(-2.5E-7, Json.parse("-2.5E-7"), "negative exponent");
        for (String bad : new String[] {"01", "1.", ".5", "-", "1e", "+1", "NaN", "Infinity", "0x10"}) {
            Check.throwsType(Json.JsonException.class, () -> Json.parse(bad), "bad number " + bad);
        }
    }

    public static void testStringsAndEscapes() throws Exception {
        Check.equal("a\"b\\c/d\b\f\n\r\t", Json.parse("\"a\\\"b\\\\c\\/d\\b\\f\\n\\r\\t\""), "escapes");
        Check.equal("\u00e9\u3131", Json.parse("\"\\u00e9\\u3131\""), "unicode escapes");
        Check.equal("\uD83D\uDE00", Json.parse("\"\\ud83d\\ude00\""), "surrogate pair escape");
        Check.equal("한글 😀", Json.parse("\"한글 😀\""), "raw UTF-16 text");
        Check.throwsType(Json.JsonException.class, () -> Json.parse("\"a\nb\""), "raw control character");
        Check.throwsType(Json.JsonException.class, () -> Json.parse("\"\\x\""), "bad escape");
        Check.throwsType(Json.JsonException.class, () -> Json.parse("\"\\u12\""), "short unicode escape");
        Check.throwsType(Json.JsonException.class, () -> Json.parse("\"abc"), "unterminated");
    }

    public static void testErrorsHavePositions() {
        Json.JsonException e = Check.throwsType(Json.JsonException.class, () -> Json.parse("{\"a\":1,}"), "trailing comma");
        Check.isTrue(e.getMessage().contains("position 7"), e.getMessage());
        Check.throwsType(Json.JsonException.class, () -> Json.parse("{} x"), "trailing garbage");
        Check.throwsType(Json.JsonException.class, () -> Json.parse(""), "empty input");
        Check.throwsType(Json.JsonException.class, () -> Json.parse("[1 2]"), "missing comma");
        Check.throwsType(Json.JsonException.class, () -> Json.parse("{1:2}"), "non-string key");
        Check.throwsType(Json.JsonException.class, () -> Json.parse("tru"), "bad literal");
        StringBuilder deep = new StringBuilder();
        for (int i = 0; i < 1000; i++) deep.append('[');
        Check.throwsType(Json.JsonException.class, () -> Json.parse(deep.toString()), "nesting limit");
    }

    public static void testWrites() {
        Map<String, Object> m = Json.obj("type", "tick", "n", 3, "l", 5L, "d", 0.25, "f", 1.5f, "big", 1e21, "t", true,
                "nil", null, "list", Arrays.asList(1, "two"), "arr", new Object[] {null});
        Check.equal("{\"type\":\"tick\",\"n\":3,\"l\":5,\"d\":0.25,\"f\":1.5,\"big\":1.0E21,\"t\":true,\"nil\":null,"
                + "\"list\":[1,\"two\"],\"arr\":[null]}", Json.write(m), "object in insertion order");
        Check.equal("[null,null,null]", Json.write(Arrays.asList(Double.NaN, Double.POSITIVE_INFINITY, Float.NaN)),
                "NaN and infinity are null");
        Check.equal("-0.0", Json.write(-0.0), "negative zero double");
    }

    public static void testWriteEscapes() {
        Check.equal("\"q\\\"b\\\\n\\nr\\rt\\tc\\u0001\\u001f\u007f\"", Json.write("q\"b\\n\nr\rt\tc\u0001\u001f\u007f"),
                "control characters");
        Check.equal("\"\uD83D\uDE00\"", Json.write("\uD83D\uDE00"), "surrogate pair kept");
        Check.equal("\"a\\ud83db\\ude00\"", Json.write("a\uD83Db\uDE00"), "lone surrogates escaped");
        Check.equal("\"\u2028\"", Json.write("\u2028"), "line separator is valid JSON as is");
        Check.isTrue(!Json.write("x\ny").contains("\n"), "no raw newline in output");
    }

    /** notice 값은 호스트 한도(protocol.ts MAX_NOTICE_TEXT 4096) 안의 글자다: 팀 보정 XML의 긴 속성·null 묶음 이름이 실행을 끝내지 않게 */
    public static void testNoticeParamsClippedAndNeverNull() throws Exception {
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        Protocol protocol = new Protocol(bytes);
        StringBuilder longText = new StringBuilder("Camera vid=");
        while (longText.length() < 5000) longText.append('x');
        Map<String, String> params = new LinkedHashMap<>();
        params.put("detail", longText.toString());
        protocol.notice(7, "visionCalibrationSkipped", params);
        protocol.notice(8, "aprilTagNoFieldPose", Collections.singletonMap("cluster", (String) null));
        String[] lines = new String(bytes.toByteArray(), java.nio.charset.StandardCharsets.UTF_8).split("\n");
        Check.equal(2, lines.length, "two lines");
        @SuppressWarnings("unchecked")
        Map<String, Object> first = (Map<String, Object>) ((Map<String, Object>) Json.parse(lines[0])).get("params");
        String detail = (String) first.get("detail");
        Check.equal(Protocol.MAX_NOTICE_CHARS, detail.length(), "clipped to the host limit");
        Check.isTrue(detail.startsWith("Camera vid=xxx") && detail.endsWith("…"), "clipped with an ellipsis");
        @SuppressWarnings("unchecked")
        Map<String, Object> second = (Map<String, Object>) ((Map<String, Object>) Json.parse(lines[1])).get("params");
        Check.equal("null", second.get("cluster"), "null value is the text null");
        // 서로게이트 짝을 가르지 않는다
        StringBuilder emoji = new StringBuilder();
        while (emoji.length() < 5000) emoji.append("\uD83D\uDE00");
        String clipped = Protocol.clip(emoji.toString(), Protocol.MAX_NOTICE_CHARS);
        Check.isTrue(clipped.length() <= Protocol.MAX_NOTICE_CHARS && !Character.isHighSurrogate(clipped.charAt(clipped.length() - 2)),
                "no lone high surrogate before the ellipsis");
    }

    public static void testRoundTrip() throws Exception {
        Object value = Json.parse("{\"s\":\"한\\u0000\\n\",\"n\":[1,-2.5,1.0E-9],\"o\":{\"k\":null}}");
        Check.equal(value, Json.parse(Json.write(value)), "round trip");
        @SuppressWarnings("unchecked")
        List<Object> n = (List<Object>) ((Map<String, Object>) value).get("n");
        Check.equal(Arrays.asList(1L, -2.5, 1.0E-9), n, "number types");
    }

    public static void testRejectsUnknownTypes() {
        Check.throwsType(IllegalArgumentException.class, () -> Json.write(new Object()), "unknown type");
        Map<Object, Object> badKey = new LinkedHashMap<>();
        badKey.put(1, 2);
        Check.throwsType(IllegalArgumentException.class, () -> Json.write(badKey), "non-string key");
    }
}
