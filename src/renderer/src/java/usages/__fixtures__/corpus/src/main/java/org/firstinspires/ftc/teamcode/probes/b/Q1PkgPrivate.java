package org.firstinspires.ftc.teamcode.probes.b;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

class Q1PkgPrivate {
    RobotHardware robot;

    class Inner extends org.firstinspires.ftc.teamcode.probes.a.Base {
        void f() {
            robot.lift.liftLeft.setPower(1); // Q1 a.Base.robot는 b에서 물려받지 않으므로 바깥 필드(생성 형식)
        }
    }
}
