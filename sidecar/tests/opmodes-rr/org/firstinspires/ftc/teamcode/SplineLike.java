package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;

// 애너테이션 없이 등록기가 클래스로 등록한다(Road Runner quickstart의 SplineTest처럼). 실행할 때 새 인스턴스를 만든다.
public class SplineLike extends LinearOpMode {
    static int created;

    public SplineLike() {
        created++;
    }

    @Override
    public void runOpMode() {
        System.out.println("RESULT spline=" + created);
        waitForStart();
    }
}
