package org.firstinspires.ftc.teamcode.probes.b;

import com.qualcomm.robotcore.hardware.DcMotorEx;
import java.util.function.Function;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

class Q2Lambda {
    RobotHardware robot;

    static void both(Function<String, Integer> f, DcMotorEx m) {
    }

    void f() {
        both(robot -> robot.length(), robot.lift.liftLeft); // Q2 람다 매개변수의 범위는 몸통뿐: 두 번째 인자는 필드
    }
}
