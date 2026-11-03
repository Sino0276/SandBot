package org.firstinspires.ftc.teamcode;

import com.acmerobotics.roadrunner.ftc.OverflowEncoder;
import com.acmerobotics.roadrunner.ftc.PositionVelocityPair;
import com.acmerobotics.roadrunner.ftc.RawEncoder;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.util.ElapsedTime;

/**
 * 라이브러리 시험(Road Runner 1.0 ftc 0.1.25, 실제 jar): quickstart처럼 엔코더를 OverflowEncoder(RawEncoder(motor))로 감싸
 * (bulk read AUTO) 일정한 power로 앞으로 2초 달리는 동안 읽는다. frontLeft는 드라이브 모터의 엔코더, backRight 포트에는 빠른
 * 데드휠(8192 CPR, 시험의 세계 설명)이 꽂혀 있다. 1.5초 뒤(정상 상태: 3c 동역학의 직진 시간 상수 약 0.15 초의 10배)부터 루프마다
 * "SAMPLE dv=… draw=… pv=… praw=…"(OverflowEncoder 속도와 RawEncoder가 읽은 getVelocity 값)를 쓰고, 끝에 "RESULT done=true".
 */
@Autonomous(name = "RR Overflow Velocity")
public class RrOverflowVelocity extends LinearOpMode {
    static final double POWER = 0.4;

    @Override
    public void runOpMode() {
        for (LynxModule module : hardwareMap.getAll(LynxModule.class)) {
            module.setBulkCachingMode(LynxModule.BulkCachingMode.AUTO);
        }
        DcMotorEx frontLeft = hardwareMap.get(DcMotorEx.class, "frontLeft");
        DcMotorEx frontRight = hardwareMap.get(DcMotorEx.class, "frontRight");
        DcMotorEx backLeft = hardwareMap.get(DcMotorEx.class, "backLeft");
        DcMotorEx backRight = hardwareMap.get(DcMotorEx.class, "backRight");
        frontLeft.setDirection(DcMotorSimple.Direction.REVERSE);
        backLeft.setDirection(DcMotorSimple.Direction.REVERSE);
        DcMotorEx[] motors = {frontLeft, frontRight, backLeft, backRight};

        // 앞으로 갈 때 둘 다 +가 되게 엔코더 방향을 정한다: RawEncoder는 REVERSE 모터(frontLeft)의 방향을 되돌리고,
        // goBILDA(CCW 형식) FORWARD 포트(backRight)는 SDK가 getVelocity의 부호를 바꾼다
        OverflowEncoder drive = new OverflowEncoder(new RawEncoder(frontLeft));
        drive.setDirection(DcMotorSimple.Direction.REVERSE);
        OverflowEncoder pod = new OverflowEncoder(new RawEncoder(backRight));
        pod.setDirection(DcMotorSimple.Direction.REVERSE);

        waitForStart();
        for (DcMotorEx motor : motors) motor.setPower(POWER);
        ElapsedTime timer = new ElapsedTime();
        while (opModeIsActive() && timer.seconds() < 2.0) {
            PositionVelocityPair d = drive.getPositionAndVelocity();
            PositionVelocityPair p = pod.getPositionAndVelocity();
            if (timer.seconds() < 1.5) continue;
            System.out.println("SAMPLE dv=" + d.velocity + " draw=" + d.rawVelocity
                    + " pv=" + p.velocity + " praw=" + p.rawVelocity);
        }
        for (DcMotorEx motor : motors) motor.setPower(0);
        System.out.println("RESULT done=true");
    }
}
