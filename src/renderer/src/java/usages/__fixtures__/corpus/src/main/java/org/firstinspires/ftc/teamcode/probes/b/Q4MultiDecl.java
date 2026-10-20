package org.firstinspires.ftc.teamcode.probes.b;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

class Q4MultiDecl {
    void f(RobotHardware x) {
        RobotHardware a = x, b = new RobotHardware(null); // Q4 선언자 둘
        b.lift.liftLeft.setPower(1);
        RobotHardware.Lift arr[] = { x.lift }, single = x.lift; // C 방식 배열 뒤의 둘째 선언자
        single.liftLeft.setPower(1);
        a.hashCode();
        arr[0].enc.setPower(0);
    }
}
