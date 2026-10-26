package org.firstinspires.ftc.teamcode;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

class LocalClass {
    void f(final RobotHardware r) {
        class Holder {
            RobotHardware hw = r; // K1 지역 클래스의 필드 형식
        }
        Holder h = new Holder();
        h.hw.lift.liftLeft.setPower(1); // K2 지역 클래스 형식의 받는 쪽: 찾지 못함
        Runnable run = new Runnable() {
            public void run() {
                r.lift.liftLeft.setPower(0); // K3 익명 클래스가 잡은 매개변수
            }
        };
        run.run();
    }
}
