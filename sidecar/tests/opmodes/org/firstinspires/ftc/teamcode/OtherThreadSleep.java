package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: 다른 스레드가 Thread.sleep(가상 시계)을 쓴다 → error thread → finished exception */
@TeleOp(name = "Other Thread")
public class OtherThreadSleep extends LinearOpMode {
    @Override
    public void runOpMode() throws InterruptedException {
        Thread worker = new Thread(() -> {
            try {
                Thread.sleep(10);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, "Worker");
        worker.start();
        while (!isStopRequested()) {
            sleep(5);
        }
    }
}
