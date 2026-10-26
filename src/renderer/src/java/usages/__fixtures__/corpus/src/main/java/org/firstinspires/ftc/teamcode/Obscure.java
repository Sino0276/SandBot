package org.firstinspires.ftc.teamcode;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

class Obscure {
    static class Holder {
        Object Lift = "x";
    }

    Object f() {
        Holder RobotHardware = new Holder();
        return RobotHardware.Lift; // O1 변수가 형식을 가린다: 사용처 아님
    }

    RobotHardware g() { // O2 형식은 그대로 형식이다
        return null;
    }
}
