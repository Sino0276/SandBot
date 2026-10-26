package org.firstinspires.ftc.teamcode.providers;

class UsesProviders {
    void f(CompProvider comp, RobotProvider any) {
        comp.robot().leftFront.setPower(0); // CV1 공변 반환(가장 아래 형식 CompBot)
        comp.robot().par.setPower(0); // CV2
        any.robot().leftFront.setPower(0); // CV3 인터페이스의 반환 형식
    }
}
