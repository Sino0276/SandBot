package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: 반복 OpMode가 requestOpModeStop()을 부르면 stop()까지 돈 뒤 finished returned */
@TeleOp(name = "Requests Stop")
public class RequestsStop extends OpMode {
    private int loops;

    @Override
    public void init() {
    }

    @Override
    public void loop() {
        if (++loops == 5) requestOpModeStop();
    }

    @Override
    public void stop() {
        System.out.println("RESULT stopCalled=true loopsAtLeast5=" + (loops >= 5));
    }
}
