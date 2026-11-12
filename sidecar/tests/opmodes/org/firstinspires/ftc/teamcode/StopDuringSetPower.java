package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: STOP을 싣는 틱 경계가 setPower의 허브 명령 비용 안에 떨어진다. 루프는 끊김 표시만 보므로(비용 없음) 가상 시간은
 * setPower로만 흐르고, LastKnown이 신선한 동안(첫 setPower 뒤 500 ms) setPower 하나는 정전력 명령 하나라 경계는 늘 그 비용 안이다.
 * 실제처럼 그 명령이 fail safe보다 먼저 허브에 가므로 STOP 뒤 모터는 fail safe 상태(멈춤·꺼짐)여야 한다. 끊김을 지우고 잠시 자서
 * afterStop 전의 틱을 볼 수 있게 한다. 구성은 runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Stop During Set Power")
public class StopDuringSetPower extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        waitForStart();
        double power = 0.5;
        while (!Thread.currentThread().isInterrupted()) {
            drive.setPower(power);
            power = 0.75 - power;
        }
        Thread.interrupted();
        sleep(50);
    }
}
