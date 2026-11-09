package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.ColorSensor;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;

/**
 * 시뮬레이터 통합 테스트(sim.test.ts I2)의 바탕: 2륜 로봇(sandbot_sim_line.xml)이 RUN_USING_ENCODER 속도로 곧게 가며
 * 아래를 보는 컬러 센서의 red()를 루프마다 읽고, 엔코더로 정한 거리를 가면 선다. 가장 큰 red()와 문턱을 넘었는지를 RESULT로 쓴다.
 * 팀 코드처럼 ColorSensor 인터페이스만 쓴다(드라이버 값 = 칩 원래 red × 1.07).
 */
public abstract class SimColorCross extends LinearOpMode {
    // 바퀴 지름 104 mm(sim.test.ts RADIUS 0.052)와 goBILDA 5202 19.2:1 출력축 1회전 틱(SDK MotorConfigurationType 537.7)
    static final double WHEEL_DIAMETER_M = 0.104;
    static final double TICKS_PER_REV = 537.7;
    // 타일과 빨강 테이프의 드라이버 red 값 가운데(spec-4c I2: (330 + 744) / 2, 부록 A 1.5 cm 표 × 1.07)
    static final int THRESHOLD = 537;

    /** 바닥 속도(m/s) */
    abstract double speed();

    /** 엔코더로 잰 이 거리(m)를 가면 선다 */
    abstract double travel();

    @Override
    public void runOpMode() {
        DcMotorEx left = hardwareMap.get(DcMotorEx.class, "left_drive");
        DcMotorEx right = hardwareMap.get(DcMotorEx.class, "right_drive");
        left.setDirection(DcMotorSimple.Direction.REVERSE);
        for (DcMotorEx motor : new DcMotorEx[] {left, right}) {
            motor.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            motor.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
            motor.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        }
        ColorSensor color = hardwareMap.get(ColorSensor.class, "sensor_color");
        double ticksPerMeter = TICKS_PER_REV / (Math.PI * WHEEL_DIAMETER_M);
        double ticksPerSecond = speed() * ticksPerMeter;
        double stopTicks = travel() * ticksPerMeter;

        waitForStart();
        left.setVelocity(ticksPerSecond);
        right.setVelocity(ticksPerSecond);
        int maxRed = 0;
        int reads = 0;
        while (opModeIsActive()) {
            int red = color.red();
            reads++;
            if (red > maxRed) maxRed = red;
            double traveled = (left.getCurrentPosition() + right.getCurrentPosition()) / 2.0;
            if (traveled >= stopTicks) break;
        }
        left.setVelocity(0);
        right.setVelocity(0);
        System.out.println(
                "RESULT maxRed=" + maxRed + " caught=" + (maxRed > THRESHOLD) + " reads=" + reads);
    }
}
