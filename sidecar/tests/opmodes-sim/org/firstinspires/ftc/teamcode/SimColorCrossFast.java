package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;

/** 시뮬레이터 통합 테스트(sim.test.ts I2): 1.5 m/s로 테이프를 가로지른다(엔코더 1.25 m를 가면 선다). */
@Autonomous(name = "Sim Color Cross Fast")
public class SimColorCrossFast extends SimColorCross {
    @Override
    double speed() {
        return 1.5;
    }

    @Override
    double travel() {
        return 1.25;
    }
}
