package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

// 목록에는 틱 교환이 없다: 등록기의 sleep은 가상 시간만 보내고 호스트를 기다리지 않는다
public class SleepyRegistrar {
    @OpModeRegistrar
    public static void register(OpModeManager manager) throws InterruptedException {
        long before = System.nanoTime();
        Thread.sleep(10_000);
        manager.register("Slept" + (System.nanoTime() - before) / 1_000_000_000L, new FactoryTuner("slept"));
    }
}
