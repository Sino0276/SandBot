package org.firstinspires.ftc.teamcode.precedence;

import com.qualcomm.robotcore.hardware.DcMotorEx;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware.*;

// C 형식 on-demand(같은 패키지에 Lift가 없다): 생성 Lift
class C {
    DcMotorEx f(Lift l) {
        return l.liftLeft;
    }
}
