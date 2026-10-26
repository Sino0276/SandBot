package org.firstinspires.ftc.teamcode.probes.b;

import com.qualcomm.robotcore.hardware.DcMotorEx;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

class Q6FieldInit {
    static RobotHardware robot = new RobotHardware(null);
    final DcMotorEx m = robot.lift.liftLeft; // Q6a 필드 초기값

    static {
        robot.leftFront.setPower(0); // Q6b static 블록
    }

    enum Mode {
        A(robot.lift.liftLeft); // Q6c enum 상수 인자

        Mode(DcMotorEx m) {
        }
    }
}
