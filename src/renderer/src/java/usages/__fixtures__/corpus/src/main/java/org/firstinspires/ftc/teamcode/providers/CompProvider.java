package org.firstinspires.ftc.teamcode.providers;

import org.firstinspires.ftc.teamcode.subclass.CompBot;

// 공변 반환으로 재정의한 메서드(CompBot robot()과 물려받은 RobotHardware robot())
public class CompProvider implements RobotProvider {
    private CompBot bot;

    @Override
    public CompBot robot() {
        return bot;
    }
}
