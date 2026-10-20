package org.firstinspires.ftc.teamcode;

import static org.firstinspires.ftc.teamcode.sandbot.PracticeBotHardware.CONFIGURATION_NAME;
import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift.Claw;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 이름을 바꾼 씬에서 깨지는 import와 이름
class Renames {
    String config = CONFIGURATION_NAME; // U1 다른 로봇 클래스의 단일 static import
    Claw claw; // U2 단일 static import한 멤버 형식
    RobotHardware.Lift.Claw full; // U3 한정한 중첩 형식
    Object literal = RobotHardware.Lift.Claw.class; // U4 클래스 리터럴
    Object grip = RobotHardware.Lift.Claw.class.getName() + claw.grip + full.grip; // U5
}
