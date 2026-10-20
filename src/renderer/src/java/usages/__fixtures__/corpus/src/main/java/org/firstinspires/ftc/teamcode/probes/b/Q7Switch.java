package org.firstinspires.ftc.teamcode.probes.b;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

class Q7Switch {
    String robot = "field";

    void f(int k, RobotHardware r) {
        switch (k) {
            case 0:
                RobotHardware robot = r;
                break;
            case 1:
                robot = r;
                robot.lift.liftLeft.setPower(1); // Q7 case 0의 지역 변수가 switch 블록 끝까지 보인다
                break;
            default:
                break;
        }
    }
}
