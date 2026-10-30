// SandBot 테스트 픽스처: 대조 기준 android.jar(API 16)에 없는 VERSION_CODES 상수도 ApiCheck 표의 값과 같으면 통과한다.
package android.os;

public class Build {
    public static class VERSION_CODES {
        public static final int JELLY_BEAN = 16;
        public static final int S = 31;
        public static final int BAKLAVA = 36;
    }
}
