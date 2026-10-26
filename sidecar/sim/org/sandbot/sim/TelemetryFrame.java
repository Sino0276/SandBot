package org.sandbot.sim;

import java.util.Collections;
import java.util.List;

/** Driver Station에 보이는 텔레메트리 한 번. lines는 DS 화면의 줄 그대로, log는 telemetry.log()의 줄(표시 순서대로). */
public final class TelemetryFrame {
    public final List<String> lines;
    public final List<String> log;
    /** "classic"·"monospace"·"html"(Telemetry.DisplayFormat) */
    public final String format;

    public TelemetryFrame(List<String> lines, List<String> log, String format) {
        this.lines = Collections.unmodifiableList(lines);
        this.log = Collections.unmodifiableList(log);
        this.format = format;
    }
}
