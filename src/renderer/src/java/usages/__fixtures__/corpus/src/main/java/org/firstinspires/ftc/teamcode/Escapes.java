package org.firstinspires.ftc.teamcode;

import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;

// E1 식별자 안의 유니코드 이스케이프(리터럴 밖): 사용처 찾기는 이 파일을 건너뛴다(javac는 글자로 바꿔 읽는다)
class Escapes {
    void f(RobotHardware r) {
        r.lift.lift\u004ceft.setPower(1);
    }
}
