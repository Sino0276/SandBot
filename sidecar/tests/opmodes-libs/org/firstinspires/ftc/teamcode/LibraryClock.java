package org.firstinspires.ftc.teamcode;

import com.arcrobotics.ftclib.util.Timing;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;

import java.util.concurrent.TimeUnit;

/**
 * 라이브러리 시험: 라이브러리 클래스(Pedro utils.Timer — System.nanoTime을 직접 부름, FTCLib Timing.Timer — ElapsedTime)도
 * 가상 시계다(LibraryClassLoader가 패치해 정의). 가상 400 ms를 재우고 잰 값과 Build.VERSION.SDK_INT(가짜 SDK의 Control Hub 값),
 * 그 클래스를 정의한 로더를 쓴다.
 */
@Autonomous(name = "Library Clock")
public class LibraryClock extends LinearOpMode {
    @Override
    public void runOpMode() throws InterruptedException {
        com.pedropathing.utils.Timer pedro = new com.pedropathing.utils.Timer();
        Timing.Timer ftclib = new Timing.Timer(10_000, TimeUnit.MILLISECONDS);
        ftclib.start();
        Thread.sleep(400);
        System.out.println("RESULT pedro=" + Math.round(pedro.milliseconds()) + " ftclib="
                + ftclib.elapsedTime() + " sdk=" + android.os.Build.VERSION.SDK_INT + " loader="
                + com.pedropathing.utils.Timer.class.getClassLoader().getClass().getSimpleName() + " team="
                + LibraryClock.class.getClassLoader().getClass().getSimpleName());
    }
}
