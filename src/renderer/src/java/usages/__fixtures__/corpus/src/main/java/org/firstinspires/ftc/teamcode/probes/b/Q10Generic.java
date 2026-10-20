package org.firstinspires.ftc.teamcode.probes.b;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

abstract class Q10Base<R extends RobotHardware> {
    protected R robot;
}

abstract class Q10Plain<R> {
    protected R robot;
}

class Q10Generic extends Q10Base<RobotHardware> {
    void f() {
        robot.lift.liftLeft.setPower(1); // Q10a 제네릭 상위 클래스의 필드: 형식 매개변수의 경계로 찾는다
    }
}

class Q10Substituted extends Q10Plain<RobotHardware> {
    void f() {
        robot.lift.liftLeft.setPower(1); // Q10b 형식 인자 치환: 찾지 못함
    }
}
