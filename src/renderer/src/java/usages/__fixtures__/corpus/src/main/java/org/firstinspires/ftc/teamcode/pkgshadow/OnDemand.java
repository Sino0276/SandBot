package org.firstinspires.ftc.teamcode.pkgshadow;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware.*;

class OnDemand {
    int f(Lift l) { // P1 같은 패키지 Lift가 on-demand를 이긴다: 사용처 아님
        return l.liftLeft;
    }
}
