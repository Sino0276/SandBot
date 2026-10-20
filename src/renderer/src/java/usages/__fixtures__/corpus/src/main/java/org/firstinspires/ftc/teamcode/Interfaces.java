package org.firstinspires.ftc.teamcode;

import static org.firstinspires.ftc.teamcode.Globals.*;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 인터페이스 상수와 팀 클래스의 static on-demand
interface HasRobot {
    RobotHardware SHARED = Globals.robot; // Z1 인터페이스 필드(public static)
}

class Interfaces implements HasRobot {
    enum Side {
        LEFT, RIGHT;

        RobotHardware.Lift lift() { // Z2 enum 메서드의 반환 형식
            return SHARED.lift; // Z3 바깥 클래스가 물려받은 인터페이스 상수
        }
    }

    void f() {
        SHARED.lift.liftLeft.setPower(1); // Z4 물려받은 인터페이스 상수
        robot.leftFront.setPower(1); // Z5 팀 클래스 static on-demand의 필드
        bots[1].lift.claw.grip.setPosition(1); // Z6 static on-demand의 배열 필드
        Side.LEFT.lift().enc.setPower(0); // Z7 enum 상수의 메서드 반환
    }
}
