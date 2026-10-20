package org.firstinspires.ftc.teamcode;

class UsesRobot {
    private final Robot robot = Robot.getInstance();

    void f() {
        Robot.getInstance().hw.lift.liftLeft.setPower(1); // R3 싱글턴 static 메서드의 반환 형식
        robot.hw.lift.liftLeft.setPower(1); // R4 팀 필드를 거친 생성 필드
        robot.hw.lift.claw.grip.setPosition(0); // R5
    }
}
