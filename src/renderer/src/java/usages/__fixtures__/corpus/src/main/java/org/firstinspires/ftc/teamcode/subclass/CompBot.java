package org.firstinspires.ftc.teamcode.subclass;

import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 생성 로봇 클래스의 하위 팀 클래스(다른 파일이 이 형식으로 생성 멤버를 쓴다)
public class CompBot extends RobotHardware {
    public CompBot(HardwareMap hardwareMap) {
        super(hardwareMap);
    }

    void zero() {
        this.par.setPower(0); // SC1 this로 쓴 물려받은 장치 필드
    }
}
