package org.firstinspires.ftc.teamcode;

// 두 단계 상속: MyRobot(→ RobotHardware)을 물려받은 클래스
class CompetitionRobot extends MyRobot {
    Lift lift2 = lift; // V1 두 단계 위 생성 클래스의 멤버 형식과 필드

    CompetitionRobot() {
        super(null);
    }

    void g() {
        lift2.liftLeft.setPower(PAR_X_MM); // V2 팀 필드를 거친 생성 필드와 물려받은 상수
    }
}
