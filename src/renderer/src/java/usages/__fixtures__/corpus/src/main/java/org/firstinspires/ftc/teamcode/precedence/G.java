package org.firstinspires.ftc.teamcode.precedence;

import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift;

import com.qualcomm.robotcore.hardware.DcMotorEx;

// G 단일 static import로 들여온 멤버 형식
class G {
    DcMotorEx f(Lift l) {
        return l.liftLeft;
    }
}
