package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: 반복 OpMode의 loop()가 0이 아닌 power를 번갈아 쓰는 동안 STOP이 온다. 반복 OpMode 스레드는 STOP에 끊기지
 * 않으므로, STOP을 싣는 틱 경계가 setPower의 정전력 명령 비용 안에 떨어지면 그 setPower는 fail safe가 잊은 켜기(위험하지 않음)를
 * 다시 보낸다. 실제처럼 그 호출 전체가 fail safe보다 먼저 허브에 가므로 STOP 뒤 모터는 fail safe 상태(멈춤·꺼짐)여야 한다.
 *
 * <p>경쟁을 정말 탔는지는 setPower 하나의 시간으로 안다(Hub 타이밍 기본값): 정전력 명령 + 켜기 = 3.0 ms는 그 경우뿐이다(첫 호출은
 * 모드 묻기까지 4.5 ms, 신선한 LastKnown이면 1.5 ms, STOP 뒤는 모드 묻기 1.5 ms 이하). stop()이 그 수를 RESULT로 쓰고 잠시 자서
 * afterStop 전의 틱을 볼 수 있게 한다. 구성은 runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Stop During Set Power Iterative")
public class StopDuringSetPowerIterative extends OpMode {
    private DcMotor drive;
    private double power = 0.5;
    private int raceCalls = 0;

    @Override
    public void init() {
        drive = hardwareMap.get(DcMotor.class, "drive");
    }

    @Override
    public void loop() {
        for (int i = 0; i < 40; i++) {
            long start = System.nanoTime();
            drive.setPower(power);
            long elapsed = System.nanoTime() - start;
            if (elapsed >= 2_900_000L && elapsed <= 3_100_000L) raceCalls++;
            power = 0.75 - power;
        }
    }

    @Override
    public void stop() {
        System.out.println("RESULT raceCalls=" + raceCalls);
        try {
            Thread.sleep(50);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
