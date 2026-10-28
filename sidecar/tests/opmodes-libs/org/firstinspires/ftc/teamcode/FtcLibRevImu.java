package org.firstinspires.ftc.teamcode;

import com.arcrobotics.ftclib.hardware.RevIMU;
import com.arcrobotics.ftclib.hardware.motors.Motor;
import com.arcrobotics.ftclib.hardware.motors.MotorEx;
import com.qualcomm.hardware.bosch.BNO055IMU;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.IMU;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;

/**
 * 라이브러리 시험(FTCLib 2.1.1 RevIMU = 옛 BNO055IMU 인터페이스): BNO055 구성(LynxEmbeddedIMU)에서 hardwareMap이 BNO055IMU도 준다.
 * 제자리에서 왼쪽으로 1초 돌고(BRAKE로 서고) 1초 뒤 RevIMU 방향(°, 칩 축 내재 ZYX의 첫째 각)과 같은 칩의 IMU 인터페이스 요(°)를 쓴다.
 * BHI260AP 구성에서는 실제처럼 RevIMU를 만들 때 IllegalArgumentException이다.
 */
@Autonomous(name = "FTCLib RevIMU")
public class FtcLibRevImu extends LinearOpMode {
    @Override
    public void runOpMode() {
        RevIMU revImu = new RevIMU(hardwareMap, "imu");
        revImu.init();
        IMU imu = hardwareMap.get(IMU.class, "imu");
        BNO055IMU raw = revImu.getRevIMU();
        MotorEx[] left = {new MotorEx(hardwareMap, "frontLeft", Motor.GoBILDA.RPM_312),
                new MotorEx(hardwareMap, "backLeft", Motor.GoBILDA.RPM_312)};
        MotorEx[] right = {new MotorEx(hardwareMap, "frontRight", Motor.GoBILDA.RPM_312),
                new MotorEx(hardwareMap, "backRight", Motor.GoBILDA.RPM_312)};
        for (MotorEx m : left) m.setInverted(true);
        for (MotorEx m : left) m.setZeroPowerBehavior(Motor.ZeroPowerBehavior.BRAKE);
        for (MotorEx m : right) m.setZeroPowerBehavior(Motor.ZeroPowerBehavior.BRAKE);
        waitForStart();
        long start = System.nanoTime();
        while (opModeIsActive() && System.nanoTime() - start < 1_000_000_000L) {
            for (MotorEx m : left) m.set(-0.4);
            for (MotorEx m : right) m.set(0.4);
        }
        for (MotorEx m : left) m.set(0);
        for (MotorEx m : right) m.set(0);
        sleep(1000);
        double heading = revImu.getHeading();
        double yaw = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
        System.out.println("RESULT heading=" + heading + " yaw=" + yaw + " status=" + raw.getSystemStatus()
                + " unit=" + raw.getParameters().angleUnit + " maker="
                + ((com.qualcomm.robotcore.hardware.HardwareDevice) raw).getManufacturer());
    }
}
