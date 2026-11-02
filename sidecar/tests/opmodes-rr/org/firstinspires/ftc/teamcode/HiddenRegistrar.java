package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

// public이 아닌 클래스의 등록기: 실제 SDK는 메서드가 public static이면 클래스의 접근과 관계없이 부른다(ART의 Method.invoke는
// public 멤버면 클래스 접근을 따지지 않는다)
final class HiddenRegistrar {
    private HiddenRegistrar() {}

    @OpModeRegistrar
    public static void register(OpModeManager manager) {
        manager.register("HiddenTop", new FactoryTuner("hidden-top"));
    }

    private static final class Inner {
        @OpModeRegistrar
        public static void register(OpModeManager manager) {
            manager.register("HiddenInner", new FactoryTuner("hidden-inner"));
        }
    }
}
