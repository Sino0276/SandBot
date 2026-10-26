package org.firstinspires.ftc.teamcode.pkgshadow;

import static org.firstinspires.ftc.teamcode.pkgshadow.Offsets.*;
import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift.Claw;
import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.PAR_X_MM;

// 이름을 바꾼 씬(par → parallel, Claw → Gripper)에서 깨지는 단일 static import. javac는 static on-demand와 같은
// 패키지로 이어서 찾는다.
class BrokenStatic {
    double x = PAR_X_MM; // P9 보통 씬은 단일 static import(생성 상수), 이름을 바꾼 씬은 Offsets의 상수(알리지 않음)
    Claw c; // P10 이름을 바꾼 씬: 같은 패키지 팀 Claw(알리지 않음)

    double g() {
        return c.grip.getPosition(); // P11 이름을 바꾼 씬: 팀 Claw에 grip이 없다
    }
}
