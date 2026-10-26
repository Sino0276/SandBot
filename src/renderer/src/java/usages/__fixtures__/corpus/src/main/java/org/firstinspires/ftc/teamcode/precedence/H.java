package org.firstinspires.ftc.teamcode.precedence;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// H 인스턴스로 쓴 static 상수와 형식으로 쓴 상수
class H {
    RobotHardware r;

    double f() {
        return r.lift.ENC_X_MM + RobotHardware.Lift.ENC_X_MM;
    }
}
