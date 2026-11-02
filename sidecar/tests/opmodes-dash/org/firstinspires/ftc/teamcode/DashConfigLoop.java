package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.FtcDashboard;
import com.acmerobotics.dashboard.config.Config;
import com.acmerobotics.dashboard.config.VariableProvider;
import com.qualcomm.robotcore.eventloop.opmode.Disabled;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;

/**
 * 라이브러리 L2 시험(FTC Dashboard 대체의 @Config): 이 클래스와 중첩 클래스의 public static 필드가 설정 트리가 되고(기본 형식, enum,
 * 배열, 객체, final 제외, @Config 이름, @Disabled 제외), runOpMode가 addConfigVariable로 변수를 더한다(autoRemove면 끝날 때 지운다).
 * 루프는 SPEED가 바뀔 때마다 "RESULT speed=… mode=… kP=… count=…"를 쓴다(호스트의 configSet이 다음 루프에 보인다).
 */
@Config
@TeleOp
public class DashConfigLoop extends LinearOpMode {
    public static double SPEED = 0.5;
    public static int COUNT = 3;
    public static boolean ENABLED = true;
    public static String LABEL = "lift";
    public static Mode MODE = Mode.FAST;
    public static Gains GAINS = new Gains();
    public static double[] ARRAY = {1, 2};
    public static final double FIXED = 1;

    public enum Mode {
        SLOW,
        FAST,
        @Deprecated
        OLD
    }

    public static class Gains {
        public double kP = 0.1;
        public double kD = 0.01;
    }

    @Config("Renamed")
    public static class Tuning {
        public static float GAIN = 2.5f;
        public static long TICKS = 1L << 40;
    }

    @Disabled
    @Config
    public static class Off {
        public static int HIDDEN = 1;
    }

    @Override
    public void runOpMode() {
        FtcDashboard dashboard = FtcDashboard.getInstance();
        dashboard.addConfigVariable("Runtime", "scale", new VariableProvider<>(2.0));
        dashboard.addConfigVariable("Runtime", "temp", new VariableProvider<>(7), true);
        waitForStart();
        double last = Double.NaN;
        while (opModeIsActive()) {
            if (SPEED != last) {
                last = SPEED;
                System.out.println("RESULT speed=" + SPEED + " mode=" + MODE + " kP=" + GAINS.kP + " count=" + COUNT
                        + " gain=" + Tuning.GAIN);
            }
            sleep(10);
        }
    }
}
