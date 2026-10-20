package org.firstinspires.ftc.teamcode.rr;

import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareMap;

// Road Runner 빠른 시작 식 드라이브: 구성 이름으로 모터를 찾는다
public final class MecanumDrive {
    public final DcMotorEx leftFront, leftBack, rightBack, rightFront;

    public MecanumDrive(HardwareMap hardwareMap) {
        leftFront = hardwareMap.get(DcMotorEx.class, "leftFront"); // N1 찾기
        leftBack = hardwareMap.get(DcMotorEx.class, "leftBack"); // N2 구성에 없는 이름
        rightBack = hardwareMap.get(DcMotorEx.class, "rightBack");
        rightFront = hardwareMap.get(DcMotorEx.class, "rightFront");
    }

    public static String PAR_NAME = "leftFront"; // N3 같은 글자(세지 않음)
}
