package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;

/**
 * 시뮬레이터 통합 테스트(sim.test.ts, 5 메커니즘 충돌 I4): 팔 관절 모터를 RUN_TO_POSITION으로 바닥 너머 목표에 보낸다. 팔의
 * 충돌체가 바닥에 막히므로 엔코더는 목표 전에 멈추고 isBusy()가 참으로 남는다. 2.5 s 뒤 위치를 적고 끝낸다.
 */
@Autonomous(name = "Sim Arm Floor")
public class SimArmFloor extends LinearOpMode {
    // 바닥 너머 목표(출력축 1회전 = 28 × 감속비 틱, 바닥에 닿는 각 약 1.44 rad보다 훨씬 멀다)
    static final int TARGET = 2500;

    @Override
    public void runOpMode() {
        DcMotorEx arm = hardwareMap.get(DcMotorEx.class, "arm");
        arm.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        arm.setTargetPosition(TARGET);
        arm.setMode(DcMotor.RunMode.RUN_TO_POSITION);

        waitForStart();
        arm.setPower(0.6);
        sleep(2500);
        System.out.println("RESULT position=" + arm.getCurrentPosition() + " busy=" + arm.isBusy()
                + " target=" + arm.getTargetPosition());
    }
}
