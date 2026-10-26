package org.firstinspires.ftc.teamcode;

class UsesGlobals {
    void f() {
        Globals.robot.lift.liftLeft.setPower(1); // G1 팀 클래스의 static 필드(다른 파일)
        Globals.bots[0].leftFront.setPower(1); // G2 배열 원소
    }
}
