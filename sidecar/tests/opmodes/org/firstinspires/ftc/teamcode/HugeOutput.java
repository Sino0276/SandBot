package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.util.RobotLog;

/**
 * 사이드카 테스트: 아주 긴 글자(RobotLog 줄, 텔레메트리 줄, 예외 메시지)도 호스트의 줄 한도(4 Mi 글자) 안의 줄로 보낸다.
 * 긴 System.out 줄은 조각으로 나누되 UTF-8 글자를 가르지 않는다.
 */
@TeleOp(name = "Huge Output")
public class HugeOutput extends LinearOpMode {
    @Override
    public void runOpMode() {
        StringBuilder huge = new StringBuilder();
        for (int i = 0; i < 5_000_000; i++) huge.append('\u0001');
        String control = huge.toString();
        RobotLog.d(control);
        telemetry.addLine(control);
        for (int i = 0; i < 20; i++) telemetry.addLine(control.substring(0, 60_000));
        telemetry.update();
        StringBuilder korean = new StringBuilder();
        for (int i = 0; i < 70_000; i++) korean.append('가');
        System.out.println(korean);
        sleep(10);
        throw new IllegalStateException(control);
    }
}
