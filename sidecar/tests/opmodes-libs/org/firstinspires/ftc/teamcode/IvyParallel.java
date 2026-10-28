package org.firstinspires.ftc.teamcode;

import static com.pedropathing.ivy.groups.Groups.parallel;
import static com.pedropathing.ivy.groups.Groups.sequential;
import static com.pedropathing.ivy.commands.Commands.instant;
import static com.pedropathing.ivy.commands.Commands.waitMs;

import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.Scheduler;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.hardware.DcMotor;

import java.util.ArrayList;
import java.util.List;

/**
 * 라이브러리 시험(Ivy 1.1.1, 실제 jar): Scheduler.schedule(sequential(parallel(…), waitMs(…)))를 반복 OpMode에서 돌린다.
 * Ivy의 Parallel은 HashMap&lt;Command, Boolean&gt;이고 Scheduler는 Collectors.toSet으로 충돌을 모은다(패치가 없으면 JVM마다 순서가 다르다).
 * 명령마다 모터 하나에 power를 쓰며 처음 실행된 순서를 기록하고, 끝나면 "RESULT order=… waited=…"를 쓴다(waitMs는 currentTimeMillis).
 */
@Autonomous(name = "Ivy Parallel")
public class IvyParallel extends OpMode {
    private final List<String> order = new ArrayList<>();
    private boolean reported;
    private long waitStarted;

    private Command drive(String name, String device, double power) {
        DcMotor motor = hardwareMap.get(DcMotor.class, device);
        int[] runs = {0};
        return Command.build()
                .setExecute(() -> {
                    if (runs[0]++ == 0) order.add(name);
                    motor.setPower(power);
                })
                .setDone(() -> runs[0] >= 30)
                .setEnd(end -> motor.setPower(0))
                .requiring(motor);
    }

    @Override
    public void init() {
        Scheduler.reset();
    }

    @Override
    public void start() {
        Scheduler.schedule(sequential(
                parallel(drive("a", "frontLeft", 0.3), drive("b", "frontRight", 0.3), drive("c", "backLeft", 0.3),
                        drive("d", "backRight", 0.3)),
                instant(() -> waitStarted = System.nanoTime()),
                waitMs(250),
                instant(() -> {
                    System.out.println("RESULT order=" + String.join(",", order) + " waited="
                            + (System.nanoTime() - waitStarted) / 1_000_000);
                    reported = true;
                })));
    }

    @Override
    public void loop() {
        Scheduler.execute();
        if (reported) requestOpModeStop();
    }
}
