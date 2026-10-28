package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * 사이드카 테스트(컴파일 기준): 플랫폼 API에 없는 JDK 패키지(java.net.http는 Android에 없다)는 호스트 JDK에 있어도 컴파일 오류다
 * (Android Studio에서도 컴파일되지 않는다).
 */
@TeleOp(name = "Platform Missing API")
public class PlatformMissingApi extends LinearOpMode {
    @Override
    public void runOpMode() {
        java.net.http.HttpClient client = java.net.http.HttpClient.newHttpClient();
        telemetry.addData("client", client);
    }
}
