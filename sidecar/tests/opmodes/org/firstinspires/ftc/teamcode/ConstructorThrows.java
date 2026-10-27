package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: 정적 초기화(OpMode 스레드에서 돈다)의 예외 → error exception(원인) → finished exception */
@TeleOp(name = "Constructor Throws")
public class ConstructorThrows extends LinearOpMode {
    static final String THREAD = Thread.currentThread().getName();
    static final int[] TABLE = build();

    private static int[] build() {
        System.out.println("RESULT staticInitThread=" + THREAD);
        throw new IllegalArgumentException("bad table");
    }

    @Override
    public void runOpMode() {
    }
}
