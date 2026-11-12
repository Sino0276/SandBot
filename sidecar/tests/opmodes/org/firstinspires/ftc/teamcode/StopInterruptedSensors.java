package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.IMU;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.VoltageUnit;

/**
 * 사이드카 테스트: STOP으로 끊긴 LinearOpMode 스레드의 루프 다음 읽기는 실제 자리값이다. 엔코더 0(Lynx 컨트롤러), IMU 요 0(모두 0인
 * 쿼터니언을 거절해 단위 사원수), VL53L0X 65535 mm(상태 레지스터 0에 끊긴 스레드), 허브 전압 0.0(LynxModule ADC). 목표 위치 쓰기는
 * 허브에 가지 않는다. 팀 코드가 끊김을 지우면 다시 진짜 값이다. 구성·입력은 runtime.test.ts가 만든다(모터 "drive", IMU "imu",
 * 거리 센서 "distance").
 */
@TeleOp(name = "Stop Interrupted Sensors")
public class StopInterruptedSensors extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        IMU imu = hardwareMap.get(IMU.class, "imu");
        DistanceSensor distance = hardwareMap.get(DistanceSensor.class, "distance");
        LynxModule hub = hardwareMap.get(LynxModule.class, "Control Hub");
        drive.setTargetPosition(1000);
        drive.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        waitForStart();
        drive.setPower(0.5);
        while (opModeIsActive()) {
            idle();
        }
        boolean interrupted = Thread.currentThread().isInterrupted();
        int position = drive.getCurrentPosition();
        double yaw = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
        double distanceMm = distance.getDistance(DistanceUnit.MM);
        double volts = hub.getInputVoltage(VoltageUnit.VOLTS);
        drive.setTargetPosition(50);
        boolean stillInterrupted = Thread.currentThread().isInterrupted();
        Thread.interrupted();
        int positionCleared = drive.getCurrentPosition();
        double yawCleared = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
        double voltsCleared = hub.getInputVoltage(VoltageUnit.VOLTS);
        System.out.println("RESULT interrupted=" + interrupted + " position=" + position + " yaw=" + Math.abs(yaw)
                + " distanceMm=" + distanceMm + " volts=" + volts + " stillInterrupted=" + stillInterrupted
                + " positionCleared=" + positionCleared + " yawCleared=" + Math.round(yawCleared)
                + " voltsCleared=" + voltsCleared);
    }
}
