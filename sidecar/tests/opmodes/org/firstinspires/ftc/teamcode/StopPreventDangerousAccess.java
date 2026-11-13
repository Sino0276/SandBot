package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * 사이드카 테스트: OpModeManagerImpl.shouldPreventDangerousHardwareAccess()를 STOP 전후에 OpMode 스레드와 수명 리스너에서 읽는다.
 * 실제 SDK 12.0은 callActiveOpModeStop이 허브 fail safe 전에 true로 두고(그래서 OpMode 스레드의 STOP 뒤 코드와 postStop 리스너는
 * true를 본다) 다음 INIT에 false로 둔다. 구성은 runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Stop Prevent Dangerous Access")
public class StopPreventDangerousAccess extends LinearOpMode {
    static final class Probe implements OpModeManagerNotifier.Notifications {
        @Override public void onOpModePreInit(OpMode opMode) {}

        @Override public void onOpModePreStart(OpMode opMode) {
            System.out.println("RESULT listenerPreStart=" + OpModeManagerImpl.shouldPreventDangerousHardwareAccess());
        }

        @Override public void onOpModePostStop(OpMode opMode) {
            System.out.println("RESULT listenerPostStop=" + OpModeManagerImpl.shouldPreventDangerousHardwareAccess());
        }
    }

    @Override
    public void runOpMode() {
        OpModeManagerImpl.getOpModeManagerOfActivity(null).registerListener(new Probe());
        boolean init = OpModeManagerImpl.shouldPreventDangerousHardwareAccess();
        waitForStart();
        boolean running = OpModeManagerImpl.shouldPreventDangerousHardwareAccess();
        while (opModeIsActive()) {
            idle();
        }
        boolean afterStop = OpModeManagerImpl.shouldPreventDangerousHardwareAccess();
        System.out.println("RESULT init=" + init + " running=" + running + " afterStop=" + afterStop);
    }
}
