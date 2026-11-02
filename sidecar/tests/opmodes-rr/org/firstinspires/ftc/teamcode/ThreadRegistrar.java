package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

// 등록기가 띄운 스레드가 시계를 쓴다(1단계는 OpMode 스레드만): error thread 하나로 실행·목록이 끝난다. 등록기는 그 스레드를
// 기다린 뒤 시계를 다시 쓰지 않고 등록한다.
public class ThreadRegistrar {
    @OpModeRegistrar
    public static void register(OpModeManager manager) throws InterruptedException {
        Thread worker = new Thread(() -> {
            try {
                Thread.sleep(1);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, "RegistrarWorker");
        worker.start();
        worker.join();
        manager.register("AfterThread", new FactoryTuner("after"));
    }
}
