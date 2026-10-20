package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 상속으로 생성 클래스를 운반하는 OpMode 상위 클래스(AutoLeft가 쓴다)
public abstract class BaseOpMode extends LinearOpMode {
    protected RobotHardware robot; // B1 필드 형식

    protected RobotHardware getRobot() { // B2 반환 형식
        return robot;
    }

    protected void initRobot() {
        robot = new RobotHardware(hardwareMap); // B3 생성
    }
}
