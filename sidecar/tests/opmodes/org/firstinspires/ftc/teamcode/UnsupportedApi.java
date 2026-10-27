package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.util.RobotLog;

/** 사이드카 테스트: 아직 지원하지 않는 SDK API → error unsupported */
@TeleOp(name = "Unsupported")
public class UnsupportedApi extends LinearOpMode {
    @Override
    public void runOpMode() {
        RobotLog.getLogFilename();
    }
}
