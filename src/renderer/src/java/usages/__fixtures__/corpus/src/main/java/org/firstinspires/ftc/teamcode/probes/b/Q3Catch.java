package org.firstinspires.ftc.teamcode.probes.b;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

class Q3Catch {
    RobotHardware robot;

    void f() {
        try {
            robot.leftFront.setPower(0);
        } catch (RuntimeException robot) {
            robot.getMessage();
        } finally {
            robot.lift.liftLeft.setPower(0); // Q3 finally는 catch 매개변수 범위 밖
        }
    }
}
