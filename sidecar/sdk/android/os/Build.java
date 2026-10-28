// SandBot: Android의 android.os.Build·Build.VERSION과 같은 API(android-4.1.1.4.jar의 공개 서명) 일부를 Control Hub 값으로 새로 쓴 것.
// 실제 Android처럼 컴파일 시간 상수가 아니다(UNKNOWN만 상수): 팀 코드·라이브러리가 실행 때 읽는다.
//  - VERSION.SDK_INT 25, RELEASE "7.1.2": REV Control Hub OS(1.1.x, FTC SDK의 LynxConstants.MINIMUM_LEGAL_CH_OS_VERSION_STRING
//    "1.1.2")는 Android 7.1.2(API 25, Nougat MR1) 기반이다(REV 문서). 이 저장소의 SDK 바이트로는 확인할 수 없는 값이라
//    라이브러리 L1 명세의 기본값(25)을 따랐다. SDK도 이 값으로 갈래를 탄다(Device.getSerialNumber: SDK_INT ≥ 26이면 getSerial).
//  - MANUFACTURER "REV Robotics": SDK의 Device.MANUFACTURER_REV. 나머지 기기 문자열은 알 수 없어 UNKNOWN("unknown")이다.
package android.os;

public class Build {
    public static final String UNKNOWN = "unknown";

    public static final String ID = value(UNKNOWN);
    public static final String DISPLAY = value(UNKNOWN);
    public static final String PRODUCT = value(UNKNOWN);
    public static final String DEVICE = value(UNKNOWN);
    public static final String BOARD = value(UNKNOWN);
    public static final String MANUFACTURER = value("REV Robotics");
    public static final String BRAND = value(UNKNOWN);
    public static final String MODEL = value(UNKNOWN);
    public static final String HARDWARE = value(UNKNOWN);
    public static final String SERIAL = value(UNKNOWN);
    public static final String TYPE = value("user");
    public static final String TAGS = value("release-keys");

    /** 컴파일 시간 상수가 되지 않게(실제 Android의 Build 필드는 실행 때 시스템 속성에서 읽는다) */
    private static String value(String s) {
        return s;
    }

    public static class VERSION {
        public static final String INCREMENTAL = value(UNKNOWN);
        public static final String RELEASE = value("7.1.2");
        /** @deprecated 실제 API처럼 SDK_INT를 쓴다 */
        @Deprecated
        public static final String SDK = value("25");
        public static final int SDK_INT = sdkInt();
        public static final String CODENAME = value("REL");

        private static int sdkInt() {
            return 25;
        }
    }
}
