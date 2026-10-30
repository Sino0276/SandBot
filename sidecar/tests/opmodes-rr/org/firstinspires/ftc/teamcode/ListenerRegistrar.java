package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

import org.firstinspires.ftc.robotcore.internal.system.AppUtil;

// Road Runner FlightRecorder처럼 앱 쪽 코드가 OpMode 관리자에 수명 알림 리스너를 등록한다(등록기 안, 실행 전)
public class ListenerRegistrar {
    static final class Logger implements OpModeManagerNotifier.Notifications {
        private final String who;

        Logger(String who) {
            this.who = who;
        }

        @Override
        public void onOpModePreInit(OpMode opMode) {
            System.out.println("LIFE " + who + " preInit " + opMode.getClass().getSimpleName());
        }

        @Override
        public void onOpModePreStart(OpMode opMode) {
            System.out.println("LIFE " + who + " preStart " + opMode.getClass().getSimpleName());
        }

        @Override
        public void onOpModePostStop(OpMode opMode) {
            System.out.println("LIFE " + who + " postStop " + opMode.getClass().getSimpleName());
        }
    }

    @OpModeRegistrar
    public static void register(OpModeManager manager) {
        OpMode active = OpModeManagerImpl.getOpModeManagerOfActivity(AppUtil.getInstance().getActivity())
                .registerListener(new Logger("registrar"));
        System.out.println("RESULT activeAtRegistrar=" + (active == null));
    }
}
