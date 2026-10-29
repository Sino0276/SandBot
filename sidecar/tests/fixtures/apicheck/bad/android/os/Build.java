// SandBot 테스트 픽스처: 대조 기준 android.jar(API 16)에 없는 VERSION_CODES 상수는 ApiCheck 표에 있고 값·수식어가 같아야 한다.
package android.os;

public class Build {
    public static class VERSION_CODES {
        // 실제는 31
        public static final int S = 32;
        // 실제는 컴파일 시간 상수
        public static final int TIRAMISU = Integer.parseInt("33");
        // 실제 API에 없다
        public static final int NOT_A_CODE = 99;
    }
}
