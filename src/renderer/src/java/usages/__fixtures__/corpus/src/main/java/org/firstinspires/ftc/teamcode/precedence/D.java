package org.firstinspires.ftc.teamcode.precedence;

import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.*;

// D static on-demand: 멤버 형식, 상수, 형식으로 쓴 상수
class D {
    double f(Lift l) {
        String s = CONFIGURATION_NAME;
        return PAR_X_MM + Lift.ENC_X_MM + s.length() + l.hashCode();
    }
}
