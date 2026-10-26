package org.firstinspires.ftc.teamcode.probes.b;

import static org.firstinspires.ftc.teamcode.probes.c.Globals.getRobot;
import static org.firstinspires.ftc.teamcode.probes.c.Globals.robot;

class Q8StaticMethodImport {
    void f() {
        robot.lift.liftLeft.setPower(1); // Q8a static import한 필드
        getRobot().leftFront.setPower(0); // Q8b static import한 메서드
    }
}
