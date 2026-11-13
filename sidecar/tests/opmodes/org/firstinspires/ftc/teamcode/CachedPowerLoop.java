package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: INIT부터 START·STOP을 모두 무시하고 같은 power만 쓰는 루프. 같은 값이라 LastKnown이 답해 허브에 보내지 않는다.
 * 캐시가 답할 때마다 실제 LastKnown이 읽는 시계 한 번(CLOCK_READ)만큼 가상 시간이 흘러 START·STOP이 적용되고, 500 ms마다
 * 신선도가 지나 다시 보내며(STOP 뒤에는 끊긴 스레드라 잠금 시도), STOP 뒤 stuckInStop으로 끝난다(전에는 가상 시간이 멈춰 STOP이
 * 적용되지 않고 stall도 아니었다). 구성은 runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Cached Power Loop")
public class CachedPowerLoop extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        while (true) drive.setPower(0.5);
    }
}
