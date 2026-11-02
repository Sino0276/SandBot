package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.config.Config;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * 라이브러리 L2 시험(FTC Dashboard 대체의 @Config): 기본 형식 필드만 있는 @Config 클래스의 정적 초기화가 던진다. Dashboard가
 * 없을 때처럼 그 예외(error exception, 이 파일의 줄)로 끝나야 한다.
 */
@Config
@TeleOp
public class DashBadConfigInit extends LinearOpMode {
    public static double SPEED = Double.parseDouble("fast");

    @Override
    public void runOpMode() {
        waitForStart();
    }
}
