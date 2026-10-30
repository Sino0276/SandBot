package linkdemo;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;

/**
 * 링크 검사 시험의 라이브러리 클래스. 실행하지 않는다(링크 검사만 본다):
 * <ul>
 *   <li>Api.gone(): jar의 Api에는 없다 → missingMember
 *   <li>new Gone(): jar에 없다 → missingClass
 *   <li>new OpModeMeta.Builder(): 가짜 SDK의 껍데기 생성자 → unsupported
 *   <li>RobotLog.getLogFilename(): 손 구현이 바로 SimUnsupportedException → unsupported
 *   <li>Api.kept(), Build.VERSION.SDK_INT, DcMotor.ZeroPowerBehavior.BRAKE, String.valueOf: 있다 → 경고 없음
 * </ul>
 */
public class User {
    public static String run() {
        int a = Api.gone() + Api.kept() + new Gone().value() + android.os.Build.VERSION.SDK_INT;
        OpModeMeta.Builder builder = new OpModeMeta.Builder();
        return String.valueOf(a) + builder + RobotLog.getLogFilename() + DcMotor.ZeroPowerBehavior.BRAKE;
    }
}
