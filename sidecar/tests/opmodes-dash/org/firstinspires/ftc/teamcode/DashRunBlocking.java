package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.FtcDashboard;
import com.acmerobotics.roadrunner.Action;
import com.acmerobotics.roadrunner.SequentialAction;
import com.acmerobotics.roadrunner.SleepAction;
import com.acmerobotics.roadrunner.ftc.Actions;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;

/**
 * 라이브러리 L2 시험(Road Runner 1.0 실제 jar + SandBot FTC Dashboard 대체): Actions.runBlocking이 루프마다 TelemetryPacket을 만들어
 * 액션에 주고 FtcDashboard.sendTelemetryPacket으로 보낸다. 액션은 data(loop·x)·로그 줄·fieldOverlay(색·굵기·원·선)를 쓰고 루프마다
 * 20 ms 쉰다. 끝나면 "RESULT loops=… instance=…"를 쓴다.
 */
@Autonomous
public class DashRunBlocking extends LinearOpMode {
    @Override
    public void runOpMode() {
        waitForStart();
        int[] loops = {0};
        Action draw = packet -> {
            loops[0]++;
            packet.put("loop", loops[0]);
            packet.put("x", loops[0] * 0.5);
            packet.addLine("step " + loops[0]);
            packet.fieldOverlay()
                    .setStroke("#3F51B5")
                    .setStrokeWidth(1)
                    .strokeCircle(loops[0] * 0.5, 0, 9)
                    .strokeLine(0, 0, loops[0], loops[0]);
            sleep(20);
            return loops[0] < 60;
        };
        Actions.runBlocking(new SequentialAction(new SleepAction(0.2), draw));
        System.out.println("RESULT loops=" + loops[0] + " instance=" + (FtcDashboard.getInstance() != null));
    }
}
