package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Disabled;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

// AnnotatedOpModeManager.register(Class): 이름·group은 애너테이션에서, @Disabled는 보지 않는다
@TeleOp(name = "Annotated", group = "annotated")
@Disabled
public class AnnotatedTuner extends LinearOpMode {
    @Override
    public void runOpMode() {
        waitForStart();
    }
}
