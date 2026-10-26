package org.firstinspires.ftc.teamcode.pkgshadow;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift.Claw;

// 이름을 바꾼 씬(Claw → Gripper)에서 깨지는 단일 import. javac는 깨진 import를 범위에 넣지 않아 Claw는 같은 패키지
// 팀 클래스가 되고, 그 클래스에 없는 grip만 알린다.
class BrokenImport {
    Claw claw; // P4 보통 씬은 생성 Claw, 이름을 바꾼 씬은 팀 Claw(알리지 않음)

    void f(Claw[] claws) {
        claw.grip.setPosition(0); // P5 이름을 바꾼 씬: 팀 Claw에 grip이 없다
        claws[0].grip.setPosition(1); // P6 배열 원소
        Claw local = claw;
        local.grip.setPosition(0.5); // P7 지역 변수
        claw.toString(); // P8 Object의 메서드(알리지 않음)
    }
}
