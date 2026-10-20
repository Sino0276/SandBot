package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 형식 이름을 가리는 것들
class MoreShadowing extends RobotHardware {
    static class RobotHardware { // J1 멤버 클래스가 단일 import를 가린다
        int team;
    }

    static final double OFFSET = org.firstinspires.ftc.teamcode.sandbot.RobotHardware.PAR_X_MM * 2; // J2 전체 이름의 상수

    MoreShadowing(HardwareMap hardwareMap) {
        super(hardwareMap);
    }

    int f(RobotHardware r) { // J3 멤버 클래스(팀): 사용처 아님
        return r.team;
    }

    <Lift> void g(Lift l) { // J4 형식 매개변수가 물려받은 멤버 형식을 가린다: 사용처 아님
        l.hashCode();
    }

    void h() {
        class Claw { // J5 지역 클래스가 바깥 형식 이름을 가린다
            int team;
        }
        Claw c = new Claw(); // 사용처 아님
        Lift l = lift; // J6 물려받은 멤버 형식과 필드
        double PAR_X_MM = c.team; // J7 지역 변수가 물려받은 상수를 가린다
        l.liftLeft.setPower(PAR_X_MM > 0 ? lift.enc.getPower() : leftFront.getPower()); // J8 조건식의 피연산자들
    }
}
