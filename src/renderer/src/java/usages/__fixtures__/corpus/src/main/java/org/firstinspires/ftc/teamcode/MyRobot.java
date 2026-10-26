package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 생성 클래스를 상속해 받는 쪽 없이 필드를 쓴다
public class MyRobot extends RobotHardware {
    public MyRobot(HardwareMap hardwareMap) {
        super(hardwareMap);
    }

    public void drive(double power) {
        leftFront.setPower(power); // M1 상속한 필드, 단순 이름
        this.lift.liftLeft.setPower(power); // M2 this + 상속
        Lift l = lift; // M3 상속한 멤버 형식의 단순 이름 + 필드
        double k = PAR_X_MM; // M4 상속한 상수, 단순 이름
        l.claw.grip.setPosition(k);
    }
}
