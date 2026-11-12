package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

import org.firstinspires.ftc.robotcore.external.navigation.VoltageUnit;

/**
 * 사이드카 테스트: OpModeManagerImpl.registerListener로 등록한 리스너(FlightRecorder 꼴)가 onOpModePostStop에서 허브를 읽고 쓴다.
 * 실제 callActiveOpModeStop은 끊기지 않은 이벤트 루프 스레드에서 리스너를 부르므로, STOP이 끊은 LinearOpMode 스레드와 관계없이
 * 명령이 허브에 간다(자리값이 아니다). 정상 종료 경로(endOpMode)다. STOP을 무시하는 경로는 {@link StopPostStopListenerStuck}.
 * 구성·입력은 runtime.test.ts가 만든다(모터 "drive", 엔코더 321틱).
 */
@TeleOp(name = "Stop PostStop Listener")
public class StopPostStopListener extends LinearOpMode {
    /** postStop에서 허브 전압·엔코더·모드를 읽고 zero power BRAKE를 쓴다 */
    static final class Probe implements OpModeManagerNotifier.Notifications {
        private final DcMotor drive;
        private final LynxModule hub;

        Probe(DcMotor drive, LynxModule hub) {
            this.drive = drive;
            this.hub = hub;
        }

        static void register(DcMotor drive, LynxModule hub) {
            OpModeManagerImpl.getOpModeManagerOfActivity(null).registerListener(new Probe(drive, hub));
        }

        @Override public void onOpModePreInit(OpMode opMode) {}

        @Override public void onOpModePreStart(OpMode opMode) {}

        @Override public void onOpModePostStop(OpMode opMode) {
            boolean interrupted = Thread.currentThread().isInterrupted();
            double volts = hub.getInputVoltage(VoltageUnit.VOLTS);
            int position = drive.getCurrentPosition();
            DcMotor.RunMode mode = drive.getMode();
            drive.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
            System.out.println("RESULT listenerInterrupted=" + interrupted + " volts=" + volts + " position=" + position
                    + " mode=" + mode);
        }
    }

    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        drive.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        Probe.register(drive, hardwareMap.get(LynxModule.class, "Control Hub"));
        waitForStart();
        while (opModeIsActive()) {
            idle();
        }
    }
}
