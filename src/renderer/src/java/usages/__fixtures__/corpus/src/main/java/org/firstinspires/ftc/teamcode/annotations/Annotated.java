package org.firstinspires.ftc.teamcode.annotations;

import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 애너테이션 인자의 생성 상수와 클래스 리터럴. 문자열과 요소 이름은 사용처가 아니다.
@TeleOp(name = "Annotated", group = RobotHardware.CONFIGURATION_NAME) // AN1 요소 값의 생성 상수
@Uses({RobotHardware.class, RobotHardware.Lift.class}) // AN2 클래스 리터럴 배열
public class Annotated {
    @Uses(RobotHardware.class) // AN3 멤버의 애너테이션
    RobotHardware robot;
}
