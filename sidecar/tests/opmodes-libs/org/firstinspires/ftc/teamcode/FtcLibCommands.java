package org.firstinspires.ftc.teamcode;

import com.arcrobotics.ftclib.command.CommandBase;
import com.arcrobotics.ftclib.command.CommandOpMode;
import com.arcrobotics.ftclib.command.ParallelCommandGroup;
import com.arcrobotics.ftclib.command.SequentialCommandGroup;
import com.arcrobotics.ftclib.command.WaitCommand;
import com.arcrobotics.ftclib.hardware.motors.Motor;
import com.arcrobotics.ftclib.hardware.motors.MotorEx;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;

import java.util.ArrayList;
import java.util.List;

/**
 * 라이브러리 시험(FTCLib 2.1.1, 실제 jar): CommandOpMode + ParallelCommandGroup(안이 HashMap&lt;Command, Boolean&gt; — 패치가 없으면
 * identity 해시 순서라 JVM마다 모터 쓰기 순서가 다르다) + MotorEx. 명령마다 모터 하나에 300 ms(가상) 동안 power를 쓰며 처음 실행된 순서를 기록하고,
 * 그다음 WaitCommand(ElapsedTime, 가상 시계)로 500 ms 기다린 뒤 멈춘다. "RESULT order=… waited=…"를 쓴다.
 */
@Autonomous(name = "FTCLib Commands")
public class FtcLibCommands extends CommandOpMode {
    static final List<String> order = new ArrayList<>();

    static final class Drive extends CommandBase {
        private final String name;
        private final MotorEx motor;
        private final double power;
        private boolean started;
        private long start;

        Drive(String name, MotorEx motor, double power) {
            this.name = name;
            this.motor = motor;
            this.power = power;
        }

        @Override
        public void initialize() {
            start = System.nanoTime();
        }

        @Override
        public void execute() {
            if (!started) order.add(name);
            started = true;
            motor.set(power);
        }

        @Override
        public boolean isFinished() {
            return System.nanoTime() - start >= 300_000_000L;
        }

        @Override
        public void end(boolean interrupted) {
            motor.set(0);
        }
    }

    @Override
    public void initialize() {
        MotorEx fl = new MotorEx(hardwareMap, "frontLeft", Motor.GoBILDA.RPM_312);
        MotorEx fr = new MotorEx(hardwareMap, "frontRight", Motor.GoBILDA.RPM_312);
        MotorEx bl = new MotorEx(hardwareMap, "backLeft", Motor.GoBILDA.RPM_312);
        MotorEx br = new MotorEx(hardwareMap, "backRight", Motor.GoBILDA.RPM_312);
        fl.setInverted(true);
        bl.setInverted(true);
        long[] waited = new long[1];
        schedule(new SequentialCommandGroup(
                new ParallelCommandGroup(new Drive("fl", fl, 0.4), new Drive("fr", fr, 0.4), new Drive("bl", bl, 0.4),
                        new Drive("br", br, 0.4), new Drive("fl2", fl, 0.4), new Drive("fr2", fr, 0.4)),
                new CommandBase() {
                    @Override
                    public void initialize() {
                        waited[0] = System.nanoTime();
                    }

                    @Override
                    public boolean isFinished() {
                        return true;
                    }
                },
                new WaitCommand(500),
                new CommandBase() {
                    @Override
                    public void initialize() {
                        System.out.println("RESULT order=" + String.join(",", order) + " waited="
                                + (System.nanoTime() - waited[0]) / 1_000_000);
                        requestOpModeStop();
                    }

                    @Override
                    public boolean isFinished() {
                        return true;
                    }
                }));
    }
}
