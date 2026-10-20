package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;

// 이 파일에는 생성 클래스 이름이 나오지 않는다(상위 클래스 BaseOpMode가 운반한다)
@Autonomous(name = "Auto Left", group = "liftLeft")
public class AutoLeft extends BaseOpMode {
    @Override
    public void runOpMode() {
        initRobot();
        waitForStart();
        robot.lift.liftLeft.setPower(1); // A1 상속한 다른 파일의 필드
        getRobot().lift.claw.grip.setPosition(0); // A2 상속한 메서드의 반환 형식
        super.robot.leftFront.setPower(0); // A3 super.필드
        robot.lift.liftLeft.setTargetPosition(robot.lift.liftLeft.getCurrentPosition() + 100); // A4 한 줄에 둘
    }
}
