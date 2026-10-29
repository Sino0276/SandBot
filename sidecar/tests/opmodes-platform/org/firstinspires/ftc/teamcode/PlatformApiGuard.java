package org.firstinspires.ftc.teamcode;

import android.os.Build;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

/**
 * 사이드카 테스트(컴파일 기준): Android API 확인 관용구. Android Studio(android.jar)에서는 Build.VERSION_CODES가 컴파일 시간
 * 상수라 비교식·애너테이션 값(@RequiresApi(api = Build.VERSION_CODES.N)처럼)·switch 상수로 쓸 수 있다. 사이드카에서는 가짜
 * SDK의 android.os.Build가 같은 상수를 준다(실행 때 SDK_INT는 Control Hub OS의 25).
 */
@TeleOp(name = "Platform API guard")
public class PlatformApiGuard extends LinearOpMode {
    @Retention(RetentionPolicy.RUNTIME)
    @interface MinApi {
        int value();
    }

    @MinApi(Build.VERSION_CODES.N)
    static String streams() {
        return "streams";
    }

    @Override
    public void runOpMode() throws InterruptedException {
        String branch = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? "O+" : "pre-O";
        String release;
        switch (Build.VERSION.SDK_INT) {
            case Build.VERSION_CODES.N_MR1:
                release = "N_MR1";
                break;
            case Build.VERSION_CODES.UPSIDE_DOWN_CAKE:
                release = "U";
                break;
            default:
                release = "other";
        }
        int min = 0;
        try {
            min = PlatformApiGuard.class.getDeclaredMethod("streams").getAnnotation(MinApi.class).value();
        } catch (NoSuchMethodException e) {
            min = -1;
        }
        System.out.println("RESULT sdk=" + Build.VERSION.SDK_INT + " branch=" + branch + " release=" + release
                + " min=" + min + " codes=" + Build.VERSION_CODES.R + "," + Build.VERSION_CODES.VANILLA_ICE_CREAM + ","
                + Build.VERSION_CODES.BAKLAVA + "," + Build.VERSION_CODES.CUR_DEVELOPMENT);
    }
}
