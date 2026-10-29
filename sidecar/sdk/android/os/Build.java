// SandBot: Android의 android.os.Build·Build.VERSION·Build.VERSION_CODES와 같은 API(android-4.1.1.4.jar의 공개 서명) 일부를
// Control Hub 값으로 새로 쓴 것. 기기 값(Build·VERSION의 필드)은 실제 Android처럼 컴파일 시간 상수가 아니다(UNKNOWN만 상수):
// 팀 코드·라이브러리가 실행 때 읽는다.
//  - VERSION.SDK_INT 25, RELEASE "7.1.2": REV Control Hub OS(1.1.x, FTC SDK의 LynxConstants.MINIMUM_LEGAL_CH_OS_VERSION_STRING
//    "1.1.2")는 Android 7.1.2(API 25, Nougat MR1) 기반이다(REV 문서). 이 저장소의 SDK 바이트로는 확인할 수 없는 값이라
//    라이브러리 L1 명세의 기본값(25)을 따랐다. SDK도 이 값으로 갈래를 탄다(Device.getSerialNumber: SDK_INT ≥ 26이면 getSerial).
//  - MANUFACTURER "REV Robotics": SDK의 Device.MANUFACTURER_REV. 나머지 기기 문자열은 알 수 없어 UNKNOWN("unknown")이다.
//  - VERSION_CODES: 실제처럼 컴파일 시간 상수다(API 확인 관용구 `SDK_INT >= VERSION_CODES.O`, `@RequiresApi(VERSION_CODES.N)`이
//    Android Studio처럼 컴파일되고 값이 인라인된다). 값은 실제 android.jar(API 37)와 같다. API 16(JELLY_BEAN)보다 새 것은
//    ApiCheck의 대조 기준 jar에 없어 ApiCheck.NEWER_ANDROID_CONSTANTS 표와 대조한다. 프로젝트 compileSdk와 관계없이 모두 있다.
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

    public static class VERSION_CODES {
        public static final int CUR_DEVELOPMENT = 10000;
        public static final int BASE = 1;
        public static final int BASE_1_1 = 2;
        public static final int CUPCAKE = 3;
        public static final int DONUT = 4;
        public static final int ECLAIR = 5;
        public static final int ECLAIR_0_1 = 6;
        public static final int ECLAIR_MR1 = 7;
        public static final int FROYO = 8;
        public static final int GINGERBREAD = 9;
        public static final int GINGERBREAD_MR1 = 10;
        public static final int HONEYCOMB = 11;
        public static final int HONEYCOMB_MR1 = 12;
        public static final int HONEYCOMB_MR2 = 13;
        public static final int ICE_CREAM_SANDWICH = 14;
        public static final int ICE_CREAM_SANDWICH_MR1 = 15;
        public static final int JELLY_BEAN = 16;
        public static final int JELLY_BEAN_MR1 = 17;
        public static final int JELLY_BEAN_MR2 = 18;
        public static final int KITKAT = 19;
        public static final int KITKAT_WATCH = 20;
        public static final int LOLLIPOP = 21;
        public static final int LOLLIPOP_MR1 = 22;
        public static final int M = 23;
        public static final int N = 24;
        public static final int N_MR1 = 25;
        public static final int O = 26;
        public static final int O_MR1 = 27;
        public static final int P = 28;
        public static final int Q = 29;
        public static final int R = 30;
        public static final int S = 31;
        public static final int S_V2 = 32;
        public static final int TIRAMISU = 33;
        public static final int UPSIDE_DOWN_CAKE = 34;
        public static final int VANILLA_ICE_CREAM = 35;
        public static final int BAKLAVA = 36;
        public static final int CINNAMON_BUN = 37;
    }
}
