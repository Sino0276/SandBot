package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 사이드카 시험(컴파일 기준): Android API(compileSdk 30 이상)에는 있지만 Java 8 API에는 없는 List.of·Set.of·Map.of를 쓴다(Pedro
 * Quickstart의 튜너들처럼). 플랫폼 jar(bootClasspath)로는 -source 8로 컴파일되고, 없으면(--release 8) 컴파일 오류다.
 * Set.of·Map.of의 순서는 패치가 삽입 순서로 바꾼다.
 */
@Autonomous(name = "Java 9 APIs")
public class Java9Apis extends LinearOpMode {
    @Override
    public void runOpMode() {
        List<String> list = List.of("x", "y", "z");
        Set<String> set = Set.of("lift", "arm", "claw", "wrist", "intake", "hood", "turret", "gate");
        Map<String, Integer> map = Map.of("one", 1, "two", 2, "three", 3, "four", 4, "five", 5);
        System.out.println("RESULT list=" + String.join(",", list) + " set=" + String.join(",", set) + " map="
                + String.join(",", map.keySet()));
    }
}
