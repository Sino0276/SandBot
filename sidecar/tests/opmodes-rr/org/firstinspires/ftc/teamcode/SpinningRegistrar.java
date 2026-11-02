package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

// 시계를 쓰지 않고 끝없이 도는 등록기: 목록은 감시(stall)가 끝낸다
public class SpinningRegistrar {
    static volatile boolean spin = true;

    @OpModeRegistrar
    public static void register(OpModeManager manager) {
        int turns = 0;
        while (spin) {
            turns++;
        }
        manager.register("Spun" + turns, new FactoryTuner("spun"));
    }
}
