package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareMap;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.function.DoubleConsumer;
import java.util.function.Function;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// 그 밖의 문법
class Extras {
    RobotHardware robot;
    Map<String, List<RobotHardware.Lift>> byName; // X1 중첩 형식 인자
    List<? extends RobotHardware> robots = new ArrayList<RobotHardware>(); // X2 와일드카드 경계, 생성의 형식 인자

    void f(Object o) {
        if (o instanceof RobotHardware.Lift) ((RobotHardware.Lift) o).claw.grip.setPosition(1); // X3 instanceof와 캐스트
        ((RobotHardware) o).lift.liftLeft.setPower(1); // X4 캐스트 받는 쪽
        List<RobotHardware> none = Collections.<RobotHardware>emptyList(); // X5 명시한 메서드 형식 인자
        Object arrayClass = RobotHardware[].class; // X6 배열 클래스 리터럴
        Function<HardwareMap, RobotHardware.Lift> make = RobotHardware.Lift::new; // X7 중첩 클래스 생성자 참조
        DoubleConsumer power = robot.lift.liftLeft::setPower; // X8 식의 메서드 참조
        int count = Globals.bots.length; // X9 배열 length: 사용처 아님
        for (RobotHardware b : Globals.bots) b.leftFront.setPower(0); // X10 배열 for-each
        org.firstinspires.ftc.teamcode.Globals.robot.lift.liftLeft.setPower(1); // X11 패키지로 한정한 팀 클래스
        Runnable r = () -> {
            RobotHardware local = robot; // X12 람다 블록의 지역 변수
            local.leftFront.setPower(0);
        };
        label:
        do {
            switch (count) {
                case 1:
                    robot.lift.enc.setPower(0); // X13 이름표·do·switch
                    break label;
                default:
                    break;
            }
        } while (count < 0);
        r.run();
        power.accept(none.size() + arrayClass.hashCode() + make.hashCode() + byName.size());
    }

    class Inner {
        DcMotorEx g() {
            return Extras.this.robot.lift.liftLeft; // X14 Outer.this
        }
    }
}
