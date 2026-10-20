package org.firstinspires.ftc.teamcode.probes.b;

import com.qualcomm.robotcore.hardware.HardwareMap;
import java.util.function.Function;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

class Q9ClassLit {
    Object a = RobotHardware.Lift.class; // Q9a 클래스 리터럴
    Function<HardwareMap, RobotHardware> s = RobotHardware::new; // Q9b 생성자 참조

    <T extends RobotHardware> void g(T t) { // Q9c 형식 매개변수의 경계
        t.lift.liftLeft.setPower(1);
    }
}
