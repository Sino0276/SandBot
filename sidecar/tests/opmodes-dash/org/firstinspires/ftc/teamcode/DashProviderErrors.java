package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.FtcDashboard;
import com.acmerobotics.dashboard.config.ValueProvider;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * 라이브러리 L2 시험(FTC Dashboard 대체의 Config): 팀 ValueProvider가 Error를 던진다. 실제로는 Dashboard 서버 스레드에서 도는 일이라
 * OpMode는 그대로 돌고 경고 로그만 남아야 한다. "get"은 처음 읽기(addConfigVariable이 형식을 정함)만 되고 그 뒤로 던지고, "set"은
 * Config 탭의 값을 받으면 던진다. 끝나면 "RESULT loops=…"를 쓴다.
 */
@TeleOp
public class DashProviderErrors extends LinearOpMode {
    @Override
    public void runOpMode() {
        FtcDashboard dashboard = FtcDashboard.getInstance();
        int[] reads = {0};
        dashboard.addConfigVariable("Faulty", "get", new ValueProvider<Double>() {
            @Override
            public Double get() {
                if (reads[0]++ > 0) throw new AssertionError("get failed");
                return 1.0;
            }

            @Override
            public void set(Double value) {}
        });
        dashboard.addConfigVariable("Faulty", "set", new ValueProvider<Double>() {
            @Override
            public Double get() {
                return 2.0;
            }

            @Override
            public void set(Double value) {
                throw new StackOverflowError("set failed");
            }
        });
        waitForStart();
        int loops = 0;
        while (opModeIsActive() && loops < 40) {
            loops++;
            sleep(20);
        }
        System.out.println("RESULT loops=" + loops);
    }
}
