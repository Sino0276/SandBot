package org.firstinspires.ftc.teamcode.precedence;

import com.qualcomm.robotcore.hardware.DcMotorEx;

// F 상속한 필드가 바깥 클래스의 필드·바깥 지역 변수를 이긴다
class F {
    String robot = "outerField";

    class Inner extends Base {
        DcMotorEx g() {
            return robot.lift.liftLeft;
        }
    }

    DcMotorEx h() {
        String robot = "local";
        robot.length();
        return new Base() {
            DcMotorEx g() {
                return robot.lift.liftLeft;
            }
        }.g();
    }
}
