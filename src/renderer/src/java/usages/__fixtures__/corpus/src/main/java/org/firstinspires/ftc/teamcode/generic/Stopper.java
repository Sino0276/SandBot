package org.firstinspires.ftc.teamcode.generic;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 경계가 둘 이상인 형식 매개변수: 다른 경계의 메서드(run)는 생성 코드에 없는 이름이 아니다
public final class Stopper {
    public static <R extends RobotHardware & Runnable> void runAndStop(R r) {
        r.run(); // IB1 둘째 경계의 메서드
        r.leftFront.setPower(0); // IB2 첫 경계의 장치 필드
        r.par.setPower(0); // IB3
    }
}
