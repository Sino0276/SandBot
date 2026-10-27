package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: 반복 OpMode의 init → init_loop… → start → loop… → stop 순서와 루프 사이 sleep(1). */
@TeleOp(name = "Iterative Order")
public class IterativeOrder extends OpMode {
    private final StringBuilder order = new StringBuilder();
    private int initLoops;
    private int loops;
    private long lastLoop;
    private long minGapNanos = Long.MAX_VALUE;

    @Override
    public void init() {
        order.append("init ");
    }

    @Override
    public void init_loop() {
        if (initLoops++ == 0) order.append("init_loop ");
    }

    @Override
    public void start() {
        order.append("start ");
    }

    @Override
    public void loop() {
        long now = System.nanoTime();
        if (loops++ == 0) order.append("loop ");
        else minGapNanos = Math.min(minGapNanos, now - lastLoop);
        lastLoop = now;
        telemetry.addData("loops", loops);
    }

    @Override
    public void stop() {
        order.append("stop");
        System.out.println("RESULT order=" + order);
        System.out.println("RESULT initLoops>0=" + (initLoops > 0) + " loops>1=" + (loops > 1));
        System.out.println("RESULT minGapAtLeast1ms=" + (minGapNanos >= 1_000_000L));
    }
}
