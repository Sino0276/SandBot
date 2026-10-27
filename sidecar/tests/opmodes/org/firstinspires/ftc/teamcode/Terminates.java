package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: terminateOpModeNow → finished terminated */
@TeleOp(name = "Terminates")
public class Terminates extends OpMode {
    private int loops;

    @Override
    public void init() {
    }

    @Override
    public void loop() {
        if (++loops == 3) terminateOpModeNow();
    }
}
