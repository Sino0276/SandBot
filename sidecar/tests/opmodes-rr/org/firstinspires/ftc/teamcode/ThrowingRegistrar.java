package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

// 던지는 등록기: 던지기 전의 등록은 남고(실제 SDK와 같다) 다음 등록기는 그대로 돈다
public class ThrowingRegistrar {
    @OpModeRegistrar
    public static void register(OpModeManager manager) {
        manager.register("BeforeThrow", new FactoryTuner("before"));
        throw new IllegalStateException("registrar broke");
    }
}
