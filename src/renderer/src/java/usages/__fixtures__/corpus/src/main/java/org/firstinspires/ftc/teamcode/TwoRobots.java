package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import org.firstinspires.ftc.teamcode.sandbot.PracticeBotHardware;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 로봇 둘: 같은 구성 이름(liftLeft)의 장치가 로봇마다 있다
@TeleOp(name = "Two Robots")
public class TwoRobots extends LinearOpMode {
    @Override
    public void runOpMode() {
        boolean practice = PracticeBotHardware.CONFIGURATION_NAME.isEmpty(); // W1 다른 로봇의 상수
        if (practice) {
            PracticeBotHardware bot = new PracticeBotHardware(hardwareMap); // W2
            bot.liftLeft.setPower(1); // W3 Practice Bot의 liftLeft
            bot.wrist.setPosition(0.5);
        } else {
            RobotHardware bot = new RobotHardware(hardwareMap); // W4 다른 블록의 같은 이름 지역 변수
            bot.lift.liftLeft.setPower(1); // W5 Comp Bot의 liftLeft
        }
    }
}
