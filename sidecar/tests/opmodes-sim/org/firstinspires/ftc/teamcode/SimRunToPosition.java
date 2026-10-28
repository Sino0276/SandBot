package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;

/**
 * 시뮬레이터 통합 테스트(sim.test.ts): 흔한 RUN_TO_POSITION Autonomous. 리셋 → 목표 → RUN_TO_POSITION을 한 번에 하고
 * {@code while (opModeIsActive() && isBusy())}로 기다린다. 시뮬레이터가 허브 펌웨어처럼 목표에 가야 루프가 끝난다.
 */
@Autonomous(name = "Sim Run To Position")
public class SimRunToPosition extends LinearOpMode {
    static final int TARGET = 1000;

    @Override
    public void runOpMode() {
        DcMotorEx frontLeft = hardwareMap.get(DcMotorEx.class, "frontLeft");
        DcMotorEx frontRight = hardwareMap.get(DcMotorEx.class, "frontRight");
        DcMotorEx backLeft = hardwareMap.get(DcMotorEx.class, "backLeft");
        DcMotorEx backRight = hardwareMap.get(DcMotorEx.class, "backRight");
        DcMotorEx[] motors = {frontLeft, frontRight, backLeft, backRight};
        frontLeft.setDirection(DcMotorSimple.Direction.REVERSE);
        backLeft.setDirection(DcMotorSimple.Direction.REVERSE);

        waitForStart();
        long start = System.nanoTime();
        for (DcMotorEx motor : motors) {
            motor.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            motor.setTargetPosition(TARGET);
            motor.setMode(DcMotor.RunMode.RUN_TO_POSITION);
            motor.setPower(0.5);
        }
        while (opModeIsActive()
                && (frontLeft.isBusy() || frontRight.isBusy() || backLeft.isBusy() || backRight.isBusy())) {
            telemetry.addData("frontLeft", frontLeft.getCurrentPosition());
            telemetry.update();
        }
        long millis = (System.nanoTime() - start) / 1_000_000L;
        System.out.println("RESULT millis=" + millis + " active=" + opModeIsActive()
                + " fl=" + frontLeft.getCurrentPosition() + " fr=" + frontRight.getCurrentPosition()
                + " bl=" + backLeft.getCurrentPosition() + " br=" + backRight.getCurrentPosition());
    }
}
