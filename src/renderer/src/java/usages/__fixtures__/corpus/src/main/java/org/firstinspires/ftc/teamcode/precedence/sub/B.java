package org.firstinspires.ftc.teamcode.precedence.sub;

import org.firstinspires.ftc.teamcode.sandbot.*;

// B 같은 패키지 형식이 생성 패키지 on-demand를 이긴다: 사용처 아님
class B {
    String f(RobotHardware r) {
        return r.team;
    }

    Object g(PracticeBotHardware p) { // B2 on-demand의 다른 로봇 클래스
        return p.wrist;
    }
}
