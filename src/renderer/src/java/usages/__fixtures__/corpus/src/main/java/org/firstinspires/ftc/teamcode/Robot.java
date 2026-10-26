package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 싱글턴: 하드웨어를 한 번 만들어 두고 OpMode마다 같은 것을 쓴다
public class Robot {
    private static Robot instance;
    public RobotHardware hw; // R0 필드 형식

    public static Robot getInstance() {
        if (instance == null) instance = new Robot();
        return instance;
    }

    public void init(HardwareMap hardwareMap) {
        hw = new RobotHardware(hardwareMap); // R1 생성
        hw.leftFront.setPower(0); // R2 받는 쪽 없는 팀 필드
    }
}
