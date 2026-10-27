package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.robotcore.external.Telemetry;

/** 사이드카 테스트: 텔레메트리 전송 간격(250 ms 가상)과 DS 줄 모양. */
@TeleOp(name = "Telemetry Rate")
public class TelemetryRate extends LinearOpMode {
    @Override
    public void runOpMode() {
        telemetry.log().add("log line %d", 1);
        int i = 0;
        while (!isStopRequested() && i < 400) {
            telemetry.addData("count", i);
            telemetry.addData("pi", "%.2f", Math.PI);
            telemetry.addData("ratio", 0.125);
            Telemetry.Line line = telemetry.addLine("pose ");
            line.addData("x", 1).addData("y", 2);
            telemetry.update();
            i++;
            sleep(5);
        }
        telemetry.setDisplayFormat(Telemetry.DisplayFormat.MONOSPACE);
        telemetry.addData("done", true);
        telemetry.update();
    }
}
