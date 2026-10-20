package org.firstinspires.ftc.teamcode.precedence.sub2;

import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.*;

// K 같은 패키지 형식이 static on-demand의 멤버 형식을 이긴다: 사용처 아님
class K {
    int f(Lift l) {
        return l.team;
    }
}
