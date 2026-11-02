package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.config.Config;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * 라이브러리 L2 시험(FTC Dashboard 대체의 @Config): public이 아닌 클래스의 public 필드. 로봇(ART)은 public 멤버면 선언 클래스가
 * public이 아니어도 리플렉션으로 읽고 쓰므로(final 쓰기만 거부) 실제 Dashboard가 이 값들을 보이고 고친다:
 * 패키지 전용 최상위 @Config 클래스(기본 형식, 배열, 패키지 전용 객체), public이 아닌 중첩 @Config 클래스, 패키지 전용 상위
 * 클래스에서 물려받은 필드. 루프는 KP가 바뀔 때마다 "RESULT kp=… ticks=… pos1=… gainP=… base=… fixedI=…"를 쓴다.
 */
@TeleOp
public class DashNonPublicConfig extends LinearOpMode {
    @Config
    static class Nested {
        public static int TICKS = 42;
    }

    @Config
    public static class Derived extends PkgBase {
    }

    @Override
    public void runOpMode() {
        waitForStart();
        double last = Double.NaN;
        while (opModeIsActive()) {
            if (PkgConstants.KP != last) {
                last = PkgConstants.KP;
                System.out.println("RESULT kp=" + PkgConstants.KP + " ticks=" + Nested.TICKS + " pos1="
                        + PkgConstants.POSITIONS[1] + " gainP=" + PkgConstants.GAINS.kP + " base=" + PkgBase.BASE
                        + " fixedI=" + PkgConstants.GAINS.kI);
            }
            sleep(10);
        }
    }
}

@Config
class PkgConstants {
    public static double KP = 0.25;
    public static double[] POSITIONS = {1.0, 2.0};
    public static PkgGains GAINS = new PkgGains();
}

class PkgGains {
    public double kP = 0.1;
    // final 필드는 트리에 보이지만(실제 ReflectionConfig는 부모 필드의 final만 본다) 로봇에서도 쓸 수 없다.
    // 상수식이 아닌 초기값이라 읽는 쪽에 값이 박히지 않는다.
    public final double kI = Double.valueOf(0.0);
}

class PkgBase {
    public static double BASE = 1.5;
}
