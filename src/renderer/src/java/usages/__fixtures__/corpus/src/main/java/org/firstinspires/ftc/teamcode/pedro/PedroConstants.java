package org.firstinspires.ftc.teamcode.pedro;

import com.pedropathing.ftc.drivetrains.MecanumConstants;

// Pedro Pathing 식 설정: 이름이 Name으로 끝나는 메서드가 구성 이름을 받는다
public class PedroConstants {
    public static MecanumConstants driveConstants = new MecanumConstants()
            .maxPower(1)
            .leftFrontMotorName("leftFront") // N7 이름이 Name으로 끝나는 메서드
            .leftRearMotorName("leftBack");
}
