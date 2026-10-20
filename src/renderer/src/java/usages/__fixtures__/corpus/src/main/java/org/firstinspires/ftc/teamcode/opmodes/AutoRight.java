package org.firstinspires.ftc.teamcode.opmodes;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import org.firstinspires.ftc.teamcode.BaseOpMode;

// 다른 패키지의 상위 클래스가 protected 필드로 운반한다
@Autonomous(name = "Auto Right")
public class AutoRight extends BaseOpMode {
    @Override
    public void runOpMode() {
        initRobot();
        robot.lift.claw.grip.setPosition(1); // AR1 다른 패키지에서 물려받은 protected 필드
        Runnable later = new Runnable() {
            @Override
            public void run() {
                robot.leftFront.setPower(0); // AR2 익명 클래스 안에서 바깥 클래스가 물려받은 필드
                getRobot().lift.liftLeft.setPower(0); // AR3 바깥 클래스가 물려받은 메서드
            }
        };
        later.run();
    }
}
