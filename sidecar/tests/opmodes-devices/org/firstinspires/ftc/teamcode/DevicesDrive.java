package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.teamcode.sandbot.ControlBotHardware;

/**
 * 사이드카 장치 테스트(devices.test.ts): SandBot이 만든 하드웨어 클래스로 팀 코드처럼 돈다. MANUAL bulk caching 루프에서
 * 게임패드로 모터를 돌리고 엔코더·IMU를 읽어, 장치 출력·센서 입력·허브 비용(루프 시간)이 런타임을 거쳐 맞는지 본다.
 */
@TeleOp(name = "Devices Drive")
public class DevicesDrive extends LinearOpMode {
    @Override
    public void runOpMode() {
        ControlBotHardware robot = new ControlBotHardware(hardwareMap);
        for (LynxModule hub : hardwareMap.getAll(LynxModule.class)) hub.setBulkCachingMode(LynxModule.BulkCachingMode.MANUAL);
        robot.lift.claw.claw.setPosition(0.75);
        waitForStart();
        int loops = 0;
        long start = System.nanoTime();
        while (opModeIsActive() && loops < 200) {
            for (LynxModule hub : hardwareMap.getAll(LynxModule.class)) hub.clearBulkCache();
            robot.motor.setPower(-gamepad1.left_stick_y);
            telemetry.addData("position", robot.motor.getCurrentPosition());
            telemetry.update();
            loops++;
        }
        long loopNanos = (System.nanoTime() - start) / loops;
        double yaw = robot.imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
        System.out.println("RESULT loops=" + loops + " position=" + robot.motor.getCurrentPosition()
                + " loopNanos=" + loopNanos + " yaw=" + Math.round(yaw));
    }
}
