package org.firstinspires.ftc.teamcode.precedence;

import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift;

// M 멤버 클래스가 static import한 형식을 가린다: 사용처 아님
class M {
    static class Lift {
        String mine = "m";
    }

    String f(Lift l) {
        return l.mine;
    }
}
