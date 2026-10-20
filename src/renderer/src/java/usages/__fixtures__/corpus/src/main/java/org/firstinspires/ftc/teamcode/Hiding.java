package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 생성 클래스를 상속해 같은 이름의 필드로 가린다
class Hiding extends RobotHardware {
    Object lift = "mine"; // Y1 생성 필드 lift를 가리는 팀 필드

    Hiding(HardwareMap hardwareMap) {
        super(hardwareMap);
    }

    void f() {
        lift.hashCode(); // Y2 가린 팀 필드: 사용처 아님
        super.lift.liftLeft.setPower(1); // Y3 super로는 생성 필드
        leftFront.setPower(0); // Y4 가리지 않은 생성 필드
        new RobotHardware(null) { // Y5 생성 클래스의 익명 하위 클래스
            void g() {
                lift.claw.grip.setPosition(0); // Y6 익명 클래스가 물려받은 필드가 바깥의 가린 필드를 이긴다
            }
        };
    }
}

class UsesHiding {
    void f(Hiding h) {
        h.lift.hashCode(); // Y7 가린 팀 필드: 사용처 아님
        h.leftFront.setPower(1); // Y8 물려받은 생성 필드
    }
}
