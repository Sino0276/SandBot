package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;

/** 시뮬레이터 통합 테스트(sim.test.ts I2): 0.15 m/s로 테이프를 가로지른다(엔코더 0.45 m를 가면 선다). */
@Autonomous(name = "Sim Color Cross Slow")
public class SimColorCrossSlow extends SimColorCross {
    @Override
    double speed() {
        return 0.15;
    }

    @Override
    double travel() {
        return 0.45;
    }
}
