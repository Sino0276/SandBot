// SandBot 테스트 픽스처: 실제 SDK에서 상수가 아닌 static final(ConstantValue 없음)은 가짜 SDK에서도 상수가 아니다.
// 그래서 이 파일은 컴파일되지 않아야 한다("constant expression required").
public final class NotConstant {
    static int kind(int id) {
        switch (id) {
            case org.firstinspires.ftc.vision.VisionPortal.DEFAULT_VIEW_CONTAINER_ID:
                return 1;
            default:
                return 0;
        }
    }
}
