package org.firstinspires.ftc.teamcode.subclass.use;

import static org.firstinspires.ftc.teamcode.subclass.CompBot.PAR_X_MM;

import org.firstinspires.ftc.teamcode.subclass.CompBot;

// 하위 팀 클래스(CompBot extends RobotHardware)를 거친 생성 멤버. 이름을 바꾼 씬(par → parallel)에서 javac가 모두 알린다.
class UsesCompBot {
    void f(CompBot bot) {
        bot.par.setPower(PAR_X_MM); // SC2 하위 클래스 받는 쪽의 장치 필드, SC3 하위 클래스로 static import한 상수
        double y = CompBot.PAR_Y_MM; // SC4 하위 클래스 형식으로 쓴 상수
        CompBot.Lift lift = bot.lift; // SC5 하위 클래스로 쓴 멤버 형식과 그룹 필드
        bot.leftFront.setPower(y); // SC6
    }
}
