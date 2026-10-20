package org.firstinspires.ftc.teamcode.subsystems;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

public class LiftSubsystem {
    private final RobotHardware.Lift lift; // S1 형식
    private final RobotHardware.Lift.Claw claw; // S2 중첩 형식

    public LiftSubsystem(RobotHardware.Lift lift) { // S3 매개변수 형식
        this.lift = lift; // S4 팀 필드: 생성 멤버 아님
        this.claw = lift.claw; // S5 매개변수가 필드를 가린다: Lift.claw
    }

    public void up() {
        lift.liftLeft.setPower(1); // S6 Lift 형식 필드
        this.lift.liftLeft.setPower(1); // S7 this.필드
        claw.grip.setPosition(1); // S8
        double k = RobotHardware.Lift.ENC_X_MM; // S9 중첩 클래스의 상수
        Lift mine = new Lift(lift); // S10 같은 패키지 팀 Lift(import 없음): 생성 형식 아님
        mine.liftLeft = 3; // S11 같은 이름의 팀 필드: 사용처 아님
        mine.up();
        claw.grip.setPosition(k);
    }
}
