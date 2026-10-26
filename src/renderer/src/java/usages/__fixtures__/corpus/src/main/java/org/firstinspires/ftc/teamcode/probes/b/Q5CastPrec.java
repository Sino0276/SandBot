package org.firstinspires.ftc.teamcode.probes.b;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

class Q5CastPrec {
    static class Holder {
        RobotHardware.Lift lift;
        Object liftLeft;
    }

    Object f(Holder h) {
        return (Object) h.lift.liftLeft; // Q5 캐스트는 h.lift.liftLeft 전체에 걸린다(liftLeft는 생성 Lift의 것)
    }
}
