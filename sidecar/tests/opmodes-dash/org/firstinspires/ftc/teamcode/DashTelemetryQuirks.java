package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.FtcDashboard;
import com.acmerobotics.dashboard.telemetry.MultipleTelemetry;
import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.robotcore.external.Telemetry;
import org.firstinspires.ftc.robotcore.external.stream.CameraStreamSource;

/**
 * 라이브러리 L2 시험(FTC Dashboard 대체의 텔레메트리): MultipleTelemetry(DS + Dashboard)의 실제 동작(Dashboard 쪽 항목이 null이라
 * setRetained가 NullPointerException, Func는 UnsupportedOperationException, Dashboard 텔레메트리는 null을 돌려줌), clear가
 * Dashboard 화면도 지움(cleared), 카메라·이미지는 안내 한 번, 한도(data 키 500, NaN op는 그리지 않음)를 본다.
 * "RESULT …"에 결과를 쓴다.
 */
@TeleOp
public class DashTelemetryQuirks extends LinearOpMode {
    private static String name(Throwable t) {
        return t == null ? "none" : t.getClass().getSimpleName();
    }

    @Override
    public void runOpMode() {
        FtcDashboard dashboard = FtcDashboard.getInstance();
        Telemetry both = new MultipleTelemetry(telemetry, dashboard.getTelemetry());
        Throwable retained = null;
        try {
            both.addData("speed", 1.5).setRetained(true);
        } catch (Throwable t) {
            retained = t;
        }
        Throwable func = null;
        try {
            both.addData("f", () -> 1);
        } catch (Throwable t) {
            func = t;
        }
        Object dashItem = dashboard.getTelemetry().addData("direct", 2);
        Object dashLine = dashboard.getTelemetry().addLine("line");
        both.log().add("logged");
        both.update();
        waitForStart();
        sleep(200);
        both.clear();
        both.addData("after", "clear");
        both.update();
        sleep(200);
        dashboard.startCameraStream((CameraStreamSource) null, 0);
        dashboard.startCameraStream((CameraStreamSource) null, 30);
        dashboard.sendImage(null);
        dashboard.sendImage(null);
        TelemetryPacket big = new TelemetryPacket(false);
        for (int i = 0; i < 600; i++) big.put(String.format("k%03d", i), i);
        big.fieldOverlay().strokeCircle(Double.NaN, 0, 1).fillCircle(1, 2, 3);
        dashboard.sendTelemetryPacket(big);
        sleep(200);
        System.out.println("RESULT retained=" + name(retained) + " func=" + name(func) + " dashItem=" + dashItem
                + " dashLine=" + dashLine + " interval="
                + dashboard.getTelemetryTransmissionInterval() + " enabled=" + dashboard.isEnabled());
    }
}
