package org.firstinspires.ftc.teamcode.precedence.sub2;

import com.qualcomm.robotcore.hardware.DcMotorEx;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift;

// L 단일 import가 같은 패키지 형식을 이긴다
class L {
    DcMotorEx f(Lift l) {
        return l.liftLeft;
    }
}
