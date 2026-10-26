package org.firstinspires.ftc.teamcode.pkgshadow.other;

import org.firstinspires.ftc.teamcode.pkgshadow.*;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift.Claw;

// 이름을 바꾼 씬(Claw → Gripper)에서 깨지는 단일 import. 같은 패키지에 Claw가 없어 on-demand(pkgshadow.Claw)로 찾는다.
class OnDemandFallback {
    double f(Claw c) { // P12 보통 씬은 단일 import가 on-demand를 이긴다
        return c.grip.getPosition(); // P13 이름을 바꾼 씬: pkgshadow.Claw에 grip이 없다
    }
}
