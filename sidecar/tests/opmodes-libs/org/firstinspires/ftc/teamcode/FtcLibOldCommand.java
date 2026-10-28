package org.firstinspires.ftc.teamcode;

import com.arcrobotics.ftclib.command.old.Command;
import com.arcrobotics.ftclib.command.old.CommandOpMode;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 라이브러리 시험(FTCLib 2.1.1의 낡은 command.old.CommandOpMode): addSequential이 스레드 풀(Executors.newScheduledThreadPool)에서
 * 명령을 돌리므로 그 스레드의 모터 쓰기가 error thread가 되고, 메시지에 지금 CommandOpMode를 쓰라는 안내가 붙는다.
 */
@Autonomous(name = "FTCLib Old Command")
public class FtcLibOldCommand extends CommandOpMode {
    private DcMotor motor;

    @Override
    public void initialize() {
        motor = hardwareMap.get(DcMotor.class, "frontLeft");
    }

    @Override
    public void run() {
        addSequential(new Command() {
            @Override
            public void initialize() {
            }

            @Override
            public void execute() {
                motor.setPower(0.3);
            }

            @Override
            public void end() {
            }

            @Override
            public boolean isFinished() {
                return false;
            }
        }, 2.0);
    }
}
