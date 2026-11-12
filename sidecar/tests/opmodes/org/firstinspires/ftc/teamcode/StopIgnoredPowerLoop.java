package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: STOP을 무시하고 0이 아닌 power만 번갈아 쓰는 루프. 값이 늘 바뀌어 LastKnown이 막지 않으므로 STOP 뒤에도
 * 부를 때마다 허브 명령을 시도한다. 끊긴 스레드의 명령은 보내지 않지만 잠금 시도마다 CLOCK_READ만큼 가상 시간이 흐르므로 stall이
 * 아니라 stuckInStop으로 끝난다(실제도 잠금에서 InterruptedException이 날 때마다 시간이 흘러 강제 정지된다). 구성은
 * runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Stop Ignored Power Loop")
public class StopIgnoredPowerLoop extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        waitForStart();
        double power = 0.5;
        while (true) {
            drive.setPower(power);
            power = 0.75 - power;
        }
    }
}
