package org.firstinspires.ftc.teamcode;

import com.acmerobotics.roadrunner.ftc.DriveViewFactory;
import com.acmerobotics.roadrunner.ftc.ForwardRampLogger;
import com.acmerobotics.roadrunner.ftc.LateralRampLogger;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;

// 실제 Road Runner jar의 튜닝 OpMode를 quickstart처럼 인스턴스로 등록한다(드라이브는 실행할 때만 만든다)
public final class RrTuners {
    private RrTuners() {}

    @OpModeRegistrar
    public static void register(OpModeManager manager) {
        DriveViewFactory dvf = hardwareMap -> {
            throw new UnsupportedOperationException("no drive in this test");
        };
        manager.register(meta(ForwardRampLogger.class), new ForwardRampLogger(dvf));
        manager.register(meta(LateralRampLogger.class), new LateralRampLogger(dvf));
    }

    private static OpModeMeta meta(Class<?> cls) {
        return new OpModeMeta.Builder()
                .setName(cls.getSimpleName())
                .setGroup("quickstart")
                .setFlavor(OpModeMeta.Flavor.TELEOP)
                .build();
    }
}
