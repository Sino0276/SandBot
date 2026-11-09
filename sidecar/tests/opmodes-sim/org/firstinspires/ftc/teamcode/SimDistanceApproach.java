package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

/**
 * 시뮬레이터 통합 테스트(sim.test.ts I1): SDK 샘플 SensorREV2mDistance와 같은 읽기(hardwareMap.get(DistanceSensor),
 * 루프마다 getDistance(DistanceUnit.MM))로 앞 벽에 다가가 150 mm 아래면 선다. 값이 바뀔 때마다 RANGE 줄을 쓴다.
 */
@Autonomous(name = "Sim Distance Approach")
public class SimDistanceApproach extends LinearOpMode {
    static final double POWER = 0.3;
    static final double STOP_MM = 150;

    @Override
    public void runOpMode() {
        DcMotor frontLeft = hardwareMap.get(DcMotor.class, "frontLeft");
        DcMotor frontRight = hardwareMap.get(DcMotor.class, "frontRight");
        DcMotor backLeft = hardwareMap.get(DcMotor.class, "backLeft");
        DcMotor backRight = hardwareMap.get(DcMotor.class, "backRight");
        DcMotor[] motors = {frontLeft, frontRight, backLeft, backRight};
        frontLeft.setDirection(DcMotorSimple.Direction.REVERSE);
        backLeft.setDirection(DcMotorSimple.Direction.REVERSE);
        DistanceSensor sensor = hardwareMap.get(DistanceSensor.class, "sensor_distance");

        waitForStart();
        for (DcMotor motor : motors) motor.setPower(POWER);
        double last = -1;
        while (opModeIsActive()) {
            double mm = sensor.getDistance(DistanceUnit.MM);
            if (mm != last) {
                System.out.println("RANGE " + mm);
                last = mm;
            }
            if (mm < STOP_MM) break;
        }
        for (DcMotor motor : motors) motor.setPower(0);
        System.out.println("RESULT stopped=" + (last < STOP_MM));
    }
}
