// SandBot 테스트 픽스처: 실제 SDK의 상수(ConstantValue)는 가짜 SDK에서도 컴파일 시간 상수다(case에 쓸 수 있다).
public final class ConstantUse {
    static int kind(String name) {
        switch (name) {
            case com.qualcomm.ftccommon.FtcEventLoopHandler.NO_VOLTAGE_SENSOR:
                return 1;
            default:
                return 0;
        }
    }

    static int nanos(long n) {
        switch ((int) (n / 1000)) {
            case (int) (com.qualcomm.robotcore.util.ElapsedTime.MILLIS_IN_NANO / 1000):
                return 1;
            default:
                return 0;
        }
    }

    public static void main(String[] args) {
        System.out.println(kind("$no$voltage$sensor$") + " " + nanos(1000000L));
    }
}
