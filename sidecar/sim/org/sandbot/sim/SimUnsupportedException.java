package org.sandbot.sim;

/**
 * 시뮬레이터가 아직 지원하지 않는 SDK API를 불렀다. 실제 SDK의 API 표면을 그대로 둔 껍데기(생성한 stub)의 메서드·생성자가
 * 던진다. 런타임은 이 예외를 error kind "unsupported"로 알린다.
 */
public class SimUnsupportedException extends UnsupportedOperationException {
    private final String api;

    /** @param api 바이너리 클래스 이름과 메서드(예: "com.qualcomm.hardware.lynx.LynxModule#getFirmwareVersionString()") */
    public SimUnsupportedException(String api) {
        super("SandBot simulator does not support " + api + " yet");
        this.api = api;
    }

    public String api() {
        return api;
    }
}
