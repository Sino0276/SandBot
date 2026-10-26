package org.firstinspires.ftc.teamcode.subsystems;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 생성 중첩 클래스와 같은 이름의 팀 서브시스템. 생성 그룹을 받아 쓴다.
public class Lift {
    public int liftLeft; // 생성 필드와 같은 이름의 팀 필드
    private final RobotHardware.Lift hw; // L1 필드 형식

    public Lift(RobotHardware.Lift hw) { // L2 매개변수 형식
        this.hw = hw;
    }

    public void up() {
        hw.liftLeft.setPower(1); // L3 필드가 받는 쪽
        liftLeft = hw.liftLeft.getCurrentPosition(); // L4 팀 필드(사용처 아님)와 생성 필드
    }
}
