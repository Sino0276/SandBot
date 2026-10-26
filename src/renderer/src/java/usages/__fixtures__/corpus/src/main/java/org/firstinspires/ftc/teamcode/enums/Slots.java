package org.firstinspires.ftc.teamcode.enums;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// enum의 암묵 메서드 values()·valueOf()의 반환 형식
public enum Slots {
    MAIN;

    public RobotHardware robot;

    static void zero() {
        Slots.values()[0].robot.leftFront.setPower(0); // EV1 values()의 원소
        valueOf("MAIN").robot.par.setPower(0); // EV2 한정 없는 valueOf()
    }
}
