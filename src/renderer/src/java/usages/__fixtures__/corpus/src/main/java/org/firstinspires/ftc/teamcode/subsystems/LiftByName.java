package org.firstinspires.ftc.teamcode.subsystems;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;
import org.firstinspires.ftc.teamcode.Constants;

// 생성 클래스 없이 구성 이름으로 장치를 찾는 서브시스템(Pushbot 식 HardwareMap 매개변수)
public class LiftByName {
    private static final String ENCODER = "enc"; // N8 같은 파일의 상수
    private final DcMotorEx motor;
    private final Servo grip;
    private final DcMotor encoder;

    public LiftByName(HardwareMap hwMap) {
        motor = hwMap.get(DcMotorEx.class, Constants.LIFT_MOTOR); // N4
        grip = hwMap.servo.get(Constants.GRIP); // N5
        encoder = hwMap.dcMotor.get(ENCODER); // N8
        motor.setPower(grip.getPosition() + encoder.getCurrentPosition());
    }
}
