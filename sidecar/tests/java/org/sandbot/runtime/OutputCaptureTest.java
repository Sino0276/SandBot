package org.sandbot.runtime;

import org.sandbot.testing.Check;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** 팀 코드 출력 가로채기: 줄 단위, 긴 줄은 UTF-8 글자를 가르지 않고 나눈다 */
public final class OutputCaptureTest {
    private OutputCaptureTest() {}

    private static List<String> capture(String text) {
        List<String> lines = new ArrayList<>();
        PrintStream out = OutputCapture.printStream("out", (stream, line) -> lines.add(line));
        out.print(text);
        out.flush();
        return lines;
    }

    private static void checkLongLine(String unit, String name) {
        StringBuilder sb = new StringBuilder();
        while (sb.toString().getBytes(StandardCharsets.UTF_8).length < OutputCapture.MAX_LINE_BYTES * 2 + 7)
            sb.append(unit);
        String text = sb.toString();
        List<String> lines = capture(text + "\n");
        Check.isTrue(lines.size() > 2, name + ": split into pieces");
        Check.equal(text, String.join("", lines), name + ": pieces join back to the original");
        for (String line : lines) Check.isTrue(!line.contains("�"), name + ": no replacement character");
    }

    public static void testLinesAndCarriageReturn() {
        Check.equal(java.util.Arrays.asList("a", "b", ""), capture("a\r\nb\n\n"), "lines");
    }

    public static void testLongLinesKeepUtf8Characters() {
        checkLongLine("x", "ascii");
        checkLongLine("가", "3-byte");
        checkLongLine("😀", "4-byte");
        checkLongLine("aé", "mixed 1·2-byte");
    }
}
