package org.firstinspires.ftc.teamcode;

class UsesMyRobot {
    void f(MyRobot r) {
        r.lift.claw.grip.setPosition(1); // M5 하위 클래스 형식의 받는 쪽(다른 파일)
    }
}
