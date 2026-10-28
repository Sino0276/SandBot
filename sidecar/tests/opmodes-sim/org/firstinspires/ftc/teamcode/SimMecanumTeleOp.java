package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.util.ElapsedTime;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.UnnormalizedAngleUnit;

/**
 * 시뮬레이터 통합 테스트(sim.test.ts): 팀 코드처럼 쓴 메카넘 TeleOp(gm0 식). 게임패드 → 모터 → 운동학 시뮬레이터 → 엔코더·IMU·
 * Pinpoint가 런타임을 거쳐 팀 코드에 닿는지 본다. START 뒤 2초(가상) 돌고 끝에 값을 RESULT 줄로 쓴다.
 */
@TeleOp(name = "Sim Mecanum")
public class SimMecanumTeleOp extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotorEx frontLeft = hardwareMap.get(DcMotorEx.class, "frontLeft");
        DcMotorEx frontRight = hardwareMap.get(DcMotorEx.class, "frontRight");
        DcMotorEx backLeft = hardwareMap.get(DcMotorEx.class, "backLeft");
        DcMotorEx backRight = hardwareMap.get(DcMotorEx.class, "backRight");
        frontLeft.setDirection(DcMotorSimple.Direction.REVERSE);
        backLeft.setDirection(DcMotorSimple.Direction.REVERSE);
        for (DcMotorEx motor : new DcMotorEx[] {frontLeft, frontRight, backLeft, backRight})
            motor.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);

        IMU imu = hardwareMap.get(IMU.class, "imu");
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.UP, RevHubOrientationOnRobot.UsbFacingDirection.FORWARD)));
        imu.resetYaw();

        GoBildaPinpointDriver pinpoint = hardwareMap.get(GoBildaPinpointDriver.class, "pinpoint");
        pinpoint.setOffsets(100, -80, DistanceUnit.MM);
        pinpoint.setEncoderResolution(GoBildaPinpointDriver.GoBildaOdometryPods.goBILDA_4_BAR_POD);
        pinpoint.setEncoderDirections(GoBildaPinpointDriver.EncoderDirection.FORWARD,
                GoBildaPinpointDriver.EncoderDirection.FORWARD);
        pinpoint.resetPosAndIMU();

        waitForStart();
        ElapsedTime timer = new ElapsedTime();
        int loops = 0;
        while (opModeIsActive() && timer.seconds() < 2.0) {
            pinpoint.update();
            double y = -gamepad1.left_stick_y;
            double x = gamepad1.left_stick_x;
            double rx = gamepad1.right_stick_x;
            frontLeft.setPower(y + x + rx);
            backLeft.setPower(y - x + rx);
            frontRight.setPower(y - x - rx);
            backRight.setPower(y + x - rx);
            telemetry.addData("yaw", imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES));
            telemetry.update();
            loops++;
        }
        for (DcMotorEx motor : new DcMotorEx[] {frontLeft, frontRight, backLeft, backRight}) motor.setPower(0);
        pinpoint.update();
        double yaw = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS);
        System.out.println("RESULT loops=" + loops
                + " fl=" + frontLeft.getCurrentPosition() + " fr=" + frontRight.getCurrentPosition()
                + " bl=" + backLeft.getCurrentPosition() + " br=" + backRight.getCurrentPosition()
                + " yaw=" + yaw
                + " px=" + pinpoint.getPosX(DistanceUnit.MM) + " py=" + pinpoint.getPosY(DistanceUnit.MM)
                + " ph=" + pinpoint.getHeading(UnnormalizedAngleUnit.RADIANS));
    }
}
