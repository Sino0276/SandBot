package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: tickReply의 게임패드가 gamepad1에 보이고 엣지 감지(aWasPressed)가 누를 때마다 한 번만 참인지 */
@TeleOp(name = "Gamepads")
public class Gamepads extends LinearOpMode {
    @Override
    public void runOpMode() {
        waitForStart();
        int pressed = 0;
        float minY = 0;
        boolean sawCross = false;
        while (opModeIsActive()) {
            if (gamepad1.aWasPressed()) pressed++;
            minY = Math.min(minY, gamepad1.left_stick_y);
            if (gamepad1.cross) sawCross = true;
            sleep(5);
        }
        System.out.println("RESULT pressed=" + pressed + " minLeftY=" + minY + " cross=" + sawCross
                + " id=" + gamepad1.getGamepadId() + " pad2id=" + gamepad2.getGamepadId());
    }
}
