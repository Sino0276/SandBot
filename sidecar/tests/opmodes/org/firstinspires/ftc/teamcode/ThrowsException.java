package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: 팀 코드 예외 → error exception(팀 소스 경로가 있는 스택) → finished exception */
@TeleOp(name = "Throws")
public class ThrowsException extends LinearOpMode {
    @Override
    public void runOpMode() {
        sleep(20);
        helper(3);
    }

    private void helper(int n) {
        throw new IllegalStateException("broken arm " + n);
    }
}
