package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;
import org.firstinspires.ftc.teamcode.subsystems.LiftSubsystem;

@TeleOp(name = "Main TeleOp")
public class MainTeleOp extends LinearOpMode {
    @Override
    public void runOpMode() {
        RobotHardware robot = new RobotHardware(hardwareMap); // T0 선언 형식과 생성
        waitForStart();
        while (opModeIsActive()) {
            robot.lift.liftLeft.setPower(-gamepad2.left_stick_y); // T1 지역 변수
            robot . lift /* 주석 */ . claw . grip.setPosition(gamepad2.a ? 1 : 0); // T2 공백·주석
            // robot.lift.liftLeft.setPower(1); T3 주석: 사용처 아님
            String s = "robot.lift.liftLeft"; // T4 문자열: 코드 사용처 아님
            DcMotorEx m = robot.leftFront; // T5 최상위 장치
            m.setPower(0); // T6 장치의 별칭: 사용처 아님
            LiftSubsystem lift = new LiftSubsystem(robot.lift); // T7 그룹 필드를 넘김
            double x = RobotHardware.PAR_X_MM + robot.lift.ENC_X_MM; // T8 형식·인스턴스로 쓴 상수
            String cfg = RobotHardware.CONFIGURATION_NAME; // T9
            new RobotHardware(hardwareMap).lift.liftLeft.setPower(0); // T10 new 식이 받는 쪽
            telemetry.addData("liftLeft", robot.lift.liftLeft.getCurrentPosition()); // T11 텔레메트리 문자열은 같은 글자
            telemetry.addData("cfg", cfg + s + x + lift);
            telemetry.update();
        }
    }
}
