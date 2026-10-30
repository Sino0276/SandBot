package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;

// 등록기가 인스턴스로 등록하는 OpMode(인수 있는 생성자라 클래스로는 만들 수 없다). 만든 인스턴스가 그대로 실행되는지 본다.
public class FactoryTuner extends LinearOpMode {
    private final String label;

    public FactoryTuner(String label) {
        this.label = label;
    }

    @Override
    public void runOpMode() {
        System.out.println("RESULT label=" + label + " hardwareMap=" + (hardwareMap != null));
        waitForStart();
        System.out.println("RESULT started=" + label);
    }
}
