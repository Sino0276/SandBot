package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

// INIT 안에서 리스너를 더한다: 이미 지난 preInit은 받지 않고 preStart·postStop만 받는다. registerListener는 지금 OpMode를 준다.
@TeleOp(name = "Listener")
public class ListenerOpMode extends LinearOpMode {
    @Override
    public void runOpMode() {
        OpMode active = OpModeManagerImpl.getOpModeManagerOfActivity(null)
                .registerListener(new ListenerRegistrar.Logger("opMode"));
        System.out.println("RESULT activeIsThis=" + (active == this));
        waitForStart();
        System.out.println("LIFE body done");
    }
}
