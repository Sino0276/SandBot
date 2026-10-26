package org.firstinspires.ftc.teamcode;

import org.firstinspires.ftc.teamcode.sandbot.*;
import java.util.List;

class Shadowing {
    RobotHardware robot;

    void localShadow() {
        robot.leftFront.setPower(0); // H1 필드
        { String robot = "x"; robot.length(); } // H2 지역 String이 가린다: 사용처 아님
        robot.leftFront.setPower(0); // H3 블록 뒤에는 다시 필드
        for (PracticeBotHardware robot : new PracticeBotHardware[0]) robot.liftLeft.setPower(1); // H4 for 변수: Practice Bot
        robot.lift.liftLeft.setPower(1); // H5 중괄호 없는 for 뒤에는 다시 필드
        try { robot.hashCode(); } catch (RuntimeException robot) { robot.getMessage(); } // H6 catch 매개변수: 사용처 아님
        Runnable r = () -> robot.lift.liftLeft.setPower(1); // H7 람다 몸통은 필드를 본다
        java.util.function.Consumer<RobotHardware.Lift> c = (RobotHardware.Lift robot) -> robot.liftLeft.setPower(1); // H8 형식 있는 람다 매개변수
        java.util.function.Consumer<RobotHardware> d = rb -> rb.lift.liftLeft.setPower(1); // H9 형식 없는 람다 매개변수: 찾지 못함
        r.run();
        c.accept(null);
        d.accept(null);
    }

    void anon() {
        String robot = "local";
        new BaseOpMode() { public void runOpMode() { robot.lift.liftLeft.setPower(1); } }; // H10 상속한 필드가 바깥 지역 변수를 이긴다
        robot.length();
    }

    void cast(Object o, List<RobotHardware.Lift> lifts) {
        ((RobotHardware.Lift) o).liftLeft.setPower(1); // H11 캐스트
        for (RobotHardware.Lift l : lifts) l.claw.grip.setPosition(1); // H12 for-each
        lifts.get(0).liftLeft.setPower(1); // H13 제네릭 반환: 찾지 못함
        RobotHardware.Lift[] arr = new RobotHardware.Lift[1]; // H14 배열 형식
        arr[0].liftLeft.setPower(1); // H15 배열 원소
        RobotHardware.Lift arr2[] = arr; arr2[0].claw.grip.setPosition(0); // H16 C 방식 차원
        (true ? robot : null).lift.liftLeft.setPower(1); // H17 조건식: 찾지 못함
    }

    RobotHardware make() {
        return robot;
    }

    void methodReturn() {
        make().lift.liftLeft.setPower(1); // H18 같은 파일 메서드의 반환 형식
    }

    static class Inner {
        Object robot;

        void f() {
            robot.hashCode(); // H19 안쪽 클래스 필드가 바깥 필드를 가린다: 사용처 아님
        }
    }
}
