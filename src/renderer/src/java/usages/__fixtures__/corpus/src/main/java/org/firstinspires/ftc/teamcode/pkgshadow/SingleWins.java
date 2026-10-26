package org.firstinspires.ftc.teamcode.pkgshadow;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift;

class SingleWins {
    void f(Lift l) { // P3 단일 import가 같은 패키지를 이긴다
        l.liftLeft.setPower(1);
    }
}
