package org.firstinspires.ftc.teamcode;

import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.CONFIGURATION_NAME;
import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift.*;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift;

class Imports {
    String a = CONFIGURATION_NAME; // I1 단일 static import
    double b = ENC_X_MM; // I2 중첩 클래스의 static on-demand
    Claw c; // I3 static on-demand로 들여온 멤버 형식

    void f(Lift l) { // I4 중첩 클래스의 단일 import
        l.liftLeft.setPower(0);
    }

    double g() {
        return org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift.ENC_X_MM; // I5 전체 이름
    }
}
